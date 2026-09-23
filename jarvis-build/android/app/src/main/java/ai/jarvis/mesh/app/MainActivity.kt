package ai.jarvis.mesh.app

import android.Manifest
import android.app.Activity
import android.content.ClipboardManager
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.Settings
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var config: MeshConfig
    private lateinit var identity: LocalIdentity
    private lateinit var relayInput: EditText
    private lateinit var peerOfferInput: EditText
    private lateinit var ownOfferText: EditText
    private lateinit var statusText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        config = MeshConfig(this)
        identity = IdentityStore(this).getOrCreate()
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 10)
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 48)
        }
        fun label(text: String) = TextView(this).apply { this.text = text; textSize = 16f }

        root.addView(label("JARVIS Mesh Android — ${identity.deviceId}"))
        statusText = label(statusLine())
        root.addView(statusText)

        root.addView(Button(this).apply {
            text = "Permitir ubicación para Encontrar mi teléfono"
            setOnClickListener {
                requestPermissions(
                    arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION),
                    11,
                )
            }
        })
        root.addView(Button(this).apply {
            text = "Dar acceso a controles multimedia"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
        })

        root.addView(label("Relay WebSocket (ws:// o wss://)"))
        relayInput = EditText(this).apply {
            setSingleLine(true)
            setText(config.relayUrl)
            hint = "wss://tu-relay.example/mesh"
        }
        root.addView(relayInput, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        root.addView(label("Oferta de emparejamiento del PC"))
        peerOfferInput = EditText(this).apply {
            minLines = 5
            hint = "Pega aquí el JSON firmado del PC"
        }
        root.addView(peerOfferInput, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        root.addView(Button(this).apply {
            text = "Verificar y guardar PC"
            setOnClickListener { savePeer() }
        })

        root.addView(Button(this).apply {
            text = "Iniciar JARVIS Mesh"
            setOnClickListener { startMesh() }
        })
        root.addView(Button(this).apply {
            text = "Detener JARVIS Mesh"
            setOnClickListener {
                stopService(Intent(this@MainActivity, MeshForegroundService::class.java))
                toast("Servicio detenido")
            }
        })

        root.addView(label("Oferta temporal de este teléfono (5 min)"))
        ownOfferText = EditText(this).apply {
            minLines = 6
            isFocusable = false
            setText(Pairing.createOffer(identity, "Android phone"))
        }
        root.addView(ownOfferText, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        root.addView(Button(this).apply {
            text = "Copiar oferta del teléfono"
            setOnClickListener {
                ownOfferText.setText(Pairing.createOffer(identity, "Android phone"))
                getSystemService(ClipboardManager::class.java)
                    .setPrimaryClip(ClipData.newPlainText("JARVIS pairing", ownOfferText.text.toString()))
                toast("Oferta copiada")
            }
        })

        setContentView(ScrollView(this).apply { addView(root) })
    }

    private fun savePeer() {
        try {
            val peer = Pairing.verifyAndParse(peerOfferInput.text.toString().trim())
            config.savePeer(peer)
            peer.relayUrl?.let {
                config.relayUrl = it
                relayInput.setText(it)
            }
            val code = Pairing.comparisonCode(peer.signingPublicKeyB64, peer.encryptionPublicKeyB64)
            statusText.text = "PC verificado: ${peer.label} (${peer.deviceId}) — código $code"
            val relayNote = peer.relayUrl?.let { " Relay configurado automáticamente." } ?: ""
            toast("PC guardado. Compara el código $code en ambos dispositivos.$relayNote")
        } catch (e: Exception) {
            toast("No se guardó: ${e.message}")
        }
    }

    private fun startMesh() {
        val relay = relayInput.text.toString().trim()
        if (!(relay.startsWith("ws://") || relay.startsWith("wss://"))) {
            toast("Introduce un relay ws:// o wss:// válido")
            return
        }
        if (config.peer() == null) {
            toast("Empareja primero el PC")
            return
        }
        config.relayUrl = relay
        startForegroundService(Intent(this, MeshForegroundService::class.java))
        toast("JARVIS Mesh iniciado")
    }

    private fun statusLine(): String {
        val profile = config.assistantId?.let { "${config.assistantName}: $it" } ?: "JARVIS aún no sincronizada"
        val peer = config.peer()?.let { "PC: ${it.label}" } ?: "Sin PC emparejado"
        return "$profile · $peer"
    }
    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_LONG).show()
}
