package ai.jarvis.mesh.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.Manifest
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class MeshForegroundService : Service() {
    private val client = OkHttpClient.Builder().pingInterval(25, TimeUnit.SECONDS).build()
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var socket: WebSocket? = null
    @Volatile private var stopped = false

    override fun onCreate() {
        super.onCreate()
        createChannel()
        val openIntent = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = android.app.Notification.Builder(this, CHANNEL)
            .setContentTitle("JARVIS Mesh")
            .setContentText("Conectando el teléfono a JARVIS")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentIntent(openIntent)
            .setOngoing(true)
            .build()
        val types = if (
            checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        ) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        } else {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        }
        startForeground(NOTIFICATION_ID, notification, types)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        stopped = false
        connect()
        return START_STICKY
    }

    private fun connect() {
        val config = MeshConfig(this)
        val peer = config.peer() ?: run { stopSelf(); return }
        val identity = IdentityStore(this).getOrCreate()
        val url = config.relayUrl
        val processor = CommandProcessor(this, identity, peer)
        if (!(url.startsWith("ws://") || url.startsWith("wss://"))) { stopSelf(); return }
        socket?.cancel()
        socket = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(JsonCodec.registrationJson(identity))
                updateNotification("Conectado como ${identity.deviceId.take(22)}…")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                worker.execute {
                    try {
                        val responsePacket = processor.process(text)
                        if (responsePacket != null) webSocket.send(responsePacket)
                    } catch (e: Exception) {
                        updateNotification("Paquete rechazado: ${e::class.java.simpleName}")
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                updateNotification("Desconectado; reintentando")
                if (!stopped) main.postDelayed({ connect() }, 5000)
            }
        })
    }

    private fun updateNotification(text: String) {
        val n = android.app.Notification.Builder(this, CHANNEL)
            .setContentTitle("JARVIS Mesh")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .build()
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, n)
    }

    private fun createChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "JARVIS Mesh", NotificationManager.IMPORTANCE_LOW)
        )
    }

    override fun onDestroy() {
        stopped = true
        socket?.close(1000, "service stopped")
        socket = null
        worker.shutdownNow()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val CHANNEL = "jarvis_mesh_connection"
        const val NOTIFICATION_ID = 2001
    }
}
