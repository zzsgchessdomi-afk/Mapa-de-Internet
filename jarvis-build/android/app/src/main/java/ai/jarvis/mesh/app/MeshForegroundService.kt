package ai.jarvis.mesh.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class MeshForegroundService : Service() {
    private val client = OkHttpClient.Builder().pingInterval(25, TimeUnit.SECONDS).build()
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val pendingPcCommands = ConcurrentHashMap<String, String>()

    @Volatile private var socket: WebSocket? = null
    @Volatile private var connected = false
    @Volatile private var stopped = false
    @Volatile private var currentIdentity: LocalIdentity? = null
    @Volatile private var currentPeer: TrustedPeer? = null

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
        if (socket == null) connect()
        if (intent?.action == ACTION_PC_COMMAND) {
            val capability = intent.getStringExtra(EXTRA_CAPABILITY).orEmpty()
            val paramsJson = intent.getStringExtra(EXTRA_PARAMS_JSON) ?: "{}"
            worker.execute { sendPcCommandWhenReady(capability, paramsJson) }
        }
        return START_STICKY
    }

    @Synchronized
    private fun connect() {
        if (socket != null || stopped) return
        val config = MeshConfig(this)
        val peer = config.peer() ?: run { stopSelf(); return }
        val identity = IdentityStore(this).getOrCreate()
        val url = config.relayUrl
        if (!(url.startsWith("ws://") || url.startsWith("wss://"))) { stopSelf(); return }

        currentIdentity = identity
        currentPeer = peer
        val processor = CommandProcessor(this, identity, peer)

        socket = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                connected = true
                webSocket.send(JsonCodec.registrationJson(identity))
                updateNotification("Conectado como ${identity.deviceId.take(22)}…")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                worker.execute {
                    try {
                        val command = processor.decode(text) ?: return@execute
                        if (command.capability == "mesh.result") {
                            handlePcResult(command)
                        } else {
                            webSocket.send(processor.executeAndRespond(command))
                        }
                    } catch (e: Exception) {
                        updateNotification("Paquete rechazado: ${e::class.java.simpleName}")
                    }
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                connected = false
                socket = null
                failPending("Conexión Mesh cerrada")
                if (!stopped) main.postDelayed({ connect() }, 1500)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                connected = false
                socket = null
                failPending("Mesh desconectado: ${t.message ?: t::class.java.simpleName}")
                updateNotification("Desconectado; reintentando")
                if (!stopped) main.postDelayed({ connect() }, 1500)
            }
        })
    }

    private fun sendPcCommandWhenReady(capability: String, paramsJson: String) {
        if (capability !in PC_OUTBOUND_SAFE) {
            publishPcResult(mapOf(
                "request_capability" to capability,
                "ok" to false,
                "data" to emptyMap<String, Any?>(),
                "error" to "Capacidad PC no permitida desde Android",
            ))
            return
        }
        var attempts = 0
        while (!connected && !stopped && attempts < 50) {
            Thread.sleep(100)
            attempts++
        }
        val ws = socket
        val identity = currentIdentity
        val peer = currentPeer
        if (!connected || ws == null || identity == null || peer == null) {
            publishPcResult(mapOf(
                "request_capability" to capability,
                "ok" to false,
                "data" to emptyMap<String, Any?>(),
                "error" to "JARVIS Mesh no está conectado al PC",
            ))
            return
        }
        try {
            @Suppress("UNCHECKED_CAST")
            val params = JsonCodec.jsonToValue(JSONObject(paramsJson)) as Map<String, Any?>
            val commandJson = JsonCodec.signedCommandJson(identity, peer.deviceId, capability, params)
            val commandId = JSONObject(commandJson).getString("command_id")
            pendingPcCommands[commandId] = capability
            val packet = JsonCodec.sealCommand(identity, peer, commandJson)
            if (!ws.send(packet)) {
                pendingPcCommands.remove(commandId)
                publishPcResult(mapOf(
                    "request_command_id" to commandId,
                    "request_capability" to capability,
                    "ok" to false,
                    "data" to emptyMap<String, Any?>(),
                    "error" to "No se pudo enviar la orden al PC",
                ))
            }
        } catch (e: Exception) {
            publishPcResult(mapOf(
                "request_capability" to capability,
                "ok" to false,
                "data" to emptyMap<String, Any?>(),
                "error" to (e.message ?: e::class.java.simpleName),
            ))
        }
    }

    private fun handlePcResult(command: VerifiedPeerCommand) {
        val requestId = command.params["request_command_id"] as? String ?: return
        if (pendingPcCommands.remove(requestId) == null) return
        publishPcResult(command.params)
    }

    private fun publishPcResult(result: Map<String, Any?>) {
        val json = JsonCodec.canonical(result)
        getSharedPreferences("jarvis_pc_results", MODE_PRIVATE)
            .edit().putString("last_result", json).apply()
        sendBroadcast(
            Intent(ACTION_PC_RESULT)
                .setPackage(packageName)
                .putExtra(EXTRA_RESULT_JSON, json)
        )
    }

    private fun failPending(error: String) {
        val caps = pendingPcCommands.values.toList()
        pendingPcCommands.clear()
        for (cap in caps) {
            publishPcResult(mapOf(
                "request_capability" to cap,
                "ok" to false,
                "data" to emptyMap<String, Any?>(),
                "error" to error,
            ))
        }
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
        connected = false
        socket?.close(1000, "service stopped")
        socket = null
        failPending("Servicio JARVIS Mesh detenido")
        worker.shutdownNow()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val CHANNEL = "jarvis_mesh_connection"
        const val NOTIFICATION_ID = 2001

        const val ACTION_PC_COMMAND = "ai.jarvis.mesh.action.PC_COMMAND"
        const val ACTION_PC_RESULT = "ai.jarvis.mesh.action.PC_RESULT"
        const val EXTRA_CAPABILITY = "capability"
        const val EXTRA_PARAMS_JSON = "params_json"
        const val EXTRA_RESULT_JSON = "result_json"

        val PC_OUTBOUND_SAFE = setOf(
            "windows.status",
            "windows.media.play_pause",
            "windows.media.next",
            "windows.media.previous",
            "windows.clipboard.set",
            "windows.app.open",
        )
    }
}
