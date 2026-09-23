package ai.jarvis.mesh.runtime

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.ClipData
import android.content.ClipboardManager
import android.content.IntentSender
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import ai.jarvis.mesh.app.JarvisNotificationListener
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Owner-authorized Android capabilities. This executor cooperates with Android's
 * permission/lock model; it never bypasses PIN, biometrics, DND, or permission UI.
 */
class AndroidDeviceExecutor(
    private val context: Context,
) : CapabilityExecutor {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var activeRingtone: Ringtone? = null

    override fun execute(capability: String, params: Map<String, Any?>): ExecutionResult = when (capability) {
        "device.status" -> deviceStatus()
        "jarvis.profile.sync" -> syncJarvisProfile(params)
        "device.ring" -> ring(params)
        "device.location.request" -> currentLocation()
        "media.play" -> mediaCommand { it.transportControls.play() }
        "media.pause" -> mediaCommand { it.transportControls.pause() }
        "media.next" -> mediaCommand { it.transportControls.skipToNext() }
        "media.previous" -> mediaCommand { it.transportControls.skipToPrevious() }
        "media.volume.set" -> setMediaVolume(params)
        "app.open" -> openApp(params)
        "notification.list" -> listNotifications(params)
        "clipboard.push" -> pushClipboard(params)
        else -> ExecutionResult(ok = false, error = "No Android executor for capability: $capability")
    }

    private fun syncJarvisProfile(params: Map<String, Any?>): ExecutionResult {
        val assistantId = (params["assistant_id"] as? String)?.trim().orEmpty()
        val name = (params["name"] as? String)?.trim().orEmpty().ifBlank { "JARVIS" }
        if (!assistantId.matches(Regex("jarvis-[A-Za-z0-9-]{10,100}"))) {
            return ExecutionResult(ok = false, error = "Invalid JARVIS assistant identity")
        }
        if (name.length > 64) return ExecutionResult(ok = false, error = "Assistant name too long")
        val config = ai.jarvis.mesh.app.MeshConfig(context)
        val existing = config.assistantId
        if (existing != null && existing != assistantId) {
            return ExecutionResult(ok = false, error = "Phone already belongs to another JARVIS identity; clear pairing locally first")
        }
        config.assistantId = assistantId
        config.assistantName = name
        return ExecutionResult(ok = true, data = mapOf(
            "assistant_id" to assistantId,
            "assistant_name" to name,
            "bound" to true,
        ))
    }

    private fun deviceStatus(): ExecutionResult {
        val battery = context.getSystemService(BatteryManager::class.java)
        val percent = battery?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val locationPermission = when {
            context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED -> "precise"
            context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED -> "approximate"
            else -> "not_granted"
        }
        return ExecutionResult(
            ok = true,
            data = mapOf(
                "manufacturer" to Build.MANUFACTURER,
                "model" to Build.MODEL,
                "android_version" to Build.VERSION.RELEASE,
                "sdk" to Build.VERSION.SDK_INT,
                "battery_percent" to percent,
                "location_permission" to locationPermission,
                "assistant_id" to ai.jarvis.mesh.app.MeshConfig(context).assistantId,
                "assistant_name" to ai.jarvis.mesh.app.MeshConfig(context).assistantName,
            ),
        )
    }

    private fun ring(params: Map<String, Any?>): ExecutionResult {
        val seconds = ((params["seconds"] as? Number)?.toLong() ?: 10L).coerceIn(1L, 60L)
        activeRingtone?.stop()
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ?: return ExecutionResult(ok = false, error = "No default ringtone configured")
        val ringtone = RingtoneManager.getRingtone(context, uri)
            ?: return ExecutionResult(ok = false, error = "Could not load ringtone")
        activeRingtone = ringtone
        ringtone.play()
        mainHandler.postDelayed({
            if (activeRingtone === ringtone) {
                ringtone.stop()
                activeRingtone = null
            }
        }, seconds * 1000L)
        return ExecutionResult(ok = true, data = mapOf("ringing" to true, "seconds" to seconds))
    }

    private fun currentLocation(): ExecutionResult {
        val fine = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fine && !coarse) {
            return ExecutionResult(ok = false, error = "Location permission not granted on phone")
        }

        val lm = context.getSystemService(LocationManager::class.java)
            ?: return ExecutionResult(ok = false, error = "Location service unavailable")
        if (!lm.isLocationEnabled) {
            return ExecutionResult(ok = false, error = "Location services are disabled on phone")
        }

        val provider = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
            .firstOrNull { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }
            ?: return ExecutionResult(ok = false, error = "No enabled location provider")

        var location: Location? = null
        val latch = CountDownLatch(1)
        return try {
            lm.getCurrentLocation(provider, null, context.mainExecutor) {
                location = it
                latch.countDown()
            }
            latch.await(8, TimeUnit.SECONDS)
            val loc = location ?: lm.getLastKnownLocation(provider)
                ?: return ExecutionResult(ok = false, error = "No location fix available")
            ExecutionResult(
                ok = true,
                data = mapOf(
                    "latitude" to loc.latitude,
                    "longitude" to loc.longitude,
                    "accuracy_m" to loc.accuracy,
                    "provider" to loc.provider,
                    "timestamp_ms" to loc.time,
                    "precision" to if (fine) "precise_allowed" else "approximate_only",
                ),
            )
        } catch (se: SecurityException) {
            ExecutionResult(ok = false, error = "Android rejected location access: ${se.message}")
        }
    }

    private fun activeMediaController(): MediaController? {
        val manager = context.getSystemService(MediaSessionManager::class.java) ?: return null
        val listener = ComponentName(context, JarvisNotificationListener::class.java)
        return manager.getActiveSessions(listener).firstOrNull()
    }

    private fun mediaCommand(action: (MediaController) -> Unit): ExecutionResult {
        return try {
            val controller = activeMediaController()
                ?: return ExecutionResult(ok = false, error = "No controllable media session. Enable Notification Access and start media playback first.")
            action(controller)
            ExecutionResult(
                ok = true,
                data = mapOf(
                    "package" to controller.packageName,
                    "playback_state" to controller.playbackState?.state,
                ),
            )
        } catch (se: SecurityException) {
            ExecutionResult(ok = false, error = "Notification Access is required for media control")
        }
    }

    private fun setMediaVolume(params: Map<String, Any?>): ExecutionResult {
        val requested = ((params["percent"] as? Number)?.toInt() ?: return ExecutionResult(
            ok = false, error = "media.volume.set requires percent 0..100"
        )).coerceIn(0, 100)
        val audio = context.getSystemService(AudioManager::class.java)
            ?: return ExecutionResult(ok = false, error = "Audio service unavailable")
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val volume = ((requested / 100.0) * max).toInt().coerceIn(0, max)
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, volume, 0)
        return ExecutionResult(ok = true, data = mapOf("percent" to requested, "stream_volume" to volume, "stream_max" to max))
    }

    private fun listNotifications(params: Map<String, Any?>): ExecutionResult {
        val limit = ((params["limit"] as? Number)?.toInt() ?: 20).coerceIn(1, 50)
        val items = JarvisNotificationListener.snapshot(context, limit)
        return ExecutionResult(ok = true, data = mapOf("notifications" to items, "count" to items.size))
    }

    private fun pushClipboard(params: Map<String, Any?>): ExecutionResult {
        val text = (params["text"] as? String) ?: return ExecutionResult(ok = false, error = "clipboard.push requires text")
        if (text.length > 10_000) return ExecutionResult(ok = false, error = "Clipboard text too long")
        val clipboard = context.getSystemService(ClipboardManager::class.java)
            ?: return ExecutionResult(ok = false, error = "Clipboard service unavailable")
        clipboard.setPrimaryClip(ClipData.newPlainText("JARVIS", text))
        return ExecutionResult(ok = true, data = mapOf("copied" to true, "characters" to text.length))
    }

    private fun transferId(params: Map<String, Any?>): String? {
        val id = (params["transfer_id"] as? String)?.trim().orEmpty()
        return id.takeIf { it.matches(Regex("[A-Za-z0-9-]{8,64}")) }
    }

    private fun transferFile(id: String): File = File(context.cacheDir, "jarvis-transfer-$id.part")

    private fun filePushBegin(params: Map<String, Any?>): ExecutionResult {
        val id = transferId(params) ?: return ExecutionResult(ok = false, error = "Invalid transfer_id")
        val rawName = (params["name"] as? String)?.trim().orEmpty()
        val name = rawName.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(120)
        if (name.isBlank() || name == "." || name == "..") {
            return ExecutionResult(ok = false, error = "Invalid file name")
        }
        val size = (params["size"] as? Number)?.toLong()
            ?: return ExecutionResult(ok = false, error = "Missing file size")
        if (size < 0 || size > 8L * 1024 * 1024) {
            return ExecutionResult(ok = false, error = "File size must be <= 8 MiB")
        }
        val sha = (params["sha256"] as? String)?.lowercase().orEmpty()
        if (!sha.matches(Regex("[0-9a-f]{64}"))) {
            return ExecutionResult(ok = false, error = "Invalid SHA-256")
        }
        val mime = (params["mime"] as? String)?.trim().orEmpty().ifBlank { "application/octet-stream" }.take(100)
        val file = transferFile(id)
        file.delete()
        file.parentFile?.mkdirs()
        file.createNewFile()
        context.getSharedPreferences("jarvis_file_transfer", Context.MODE_PRIVATE).edit()
            .putString("$id.name", name)
            .putString("$id.sha", sha)
            .putString("$id.mime", mime)
            .putLong("$id.size", size)
            .putInt("$id.next", 0)
            .apply()
        return ExecutionResult(ok = true, data = mapOf("transfer_id" to id, "accepted" to true, "max_chunk_bytes" to 32768))
    }

    private fun filePushChunk(params: Map<String, Any?>): ExecutionResult {
        val id = transferId(params) ?: return ExecutionResult(ok = false, error = "Invalid transfer_id")
        val prefs = context.getSharedPreferences("jarvis_file_transfer", Context.MODE_PRIVATE)
        if (!prefs.contains("$id.size")) return ExecutionResult(ok = false, error = "Unknown transfer")
        val index = (params["index"] as? Number)?.toInt()
            ?: return ExecutionResult(ok = false, error = "Missing chunk index")
        val expected = prefs.getInt("$id.next", 0)
        if (index != expected) return ExecutionResult(ok = false, error = "Expected chunk $expected, got $index")
        val encoded = params["data_b64"] as? String
            ?: return ExecutionResult(ok = false, error = "Missing chunk data")
        val bytes = try {
            Base64.decode(encoded, Base64.URL_SAFE)
        } catch (_: IllegalArgumentException) {
            return ExecutionResult(ok = false, error = "Invalid chunk encoding")
        }
        if (bytes.size > 32768) return ExecutionResult(ok = false, error = "Chunk too large")
        val file = transferFile(id)
        val targetSize = prefs.getLong("$id.size", -1)
        if (file.length() + bytes.size > targetSize) {
            return ExecutionResult(ok = false, error = "Transfer exceeds declared size")
        }
        file.outputStream().buffered().use { }
        file.appendBytes(bytes)
        prefs.edit().putInt("$id.next", expected + 1).apply()
        return ExecutionResult(ok = true, data = mapOf("transfer_id" to id, "index" to index, "received_bytes" to file.length()))
    }

    private fun filePushCommit(params: Map<String, Any?>): ExecutionResult {
        val id = transferId(params) ?: return ExecutionResult(ok = false, error = "Invalid transfer_id")
        val prefs = context.getSharedPreferences("jarvis_file_transfer", Context.MODE_PRIVATE)
        val expectedSize = prefs.getLong("$id.size", -1)
        val expectedSha = prefs.getString("$id.sha", null)
            ?: return ExecutionResult(ok = false, error = "Unknown transfer")
        val file = transferFile(id)
        if (!file.exists() || file.length() != expectedSize) {
            return ExecutionResult(ok = false, error = "File size verification failed")
        }
        val digest = MessageDigest.getInstance("SHA-256").digest(file.readBytes())
            .joinToString("") { "%02x".format(it) }
        if (digest != expectedSha) {
            file.delete()
            return ExecutionResult(ok = false, error = "SHA-256 verification failed")
        }
        val name = prefs.getString("$id.name", "JARVIS-file") ?: "JARVIS-file"
        val mime = prefs.getString("$id.mime", "application/octet-stream") ?: "application/octet-stream"
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, "Download/JARVIS")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: return ExecutionResult(ok = false, error = "Could not create Downloads entry")
        return try {
            resolver.openOutputStream(uri, "w")?.use { output ->
                file.inputStream().use { input -> input.copyTo(output) }
            } ?: throw IllegalStateException("Could not open Downloads output stream")
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            file.delete()
            prefs.edit()
                .remove("$id.name").remove("$id.sha").remove("$id.mime")
                .remove("$id.size").remove("$id.next").apply()
            ExecutionResult(ok = true, data = mapOf(
                "transfer_id" to id, "saved" to true, "name" to name,
                "bytes" to expectedSize, "sha256" to digest, "uri" to uri.toString(),
            ))
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            ExecutionResult(ok = false, error = "Could not save file: ${e.message ?: e::class.java.simpleName}")
        }
    }

    private fun openApp(params: Map<String, Any?>): ExecutionResult {
        val packageName = (params["package"] as? String)?.trim().orEmpty()
        if (packageName.isBlank() || packageName.length > 200 || !packageName.matches(Regex("[A-Za-z0-9_.]+"))) {
            return ExecutionResult(ok = false, error = "app.open requires a valid package name")
        }
        return try {
            val sender: IntentSender = context.packageManager.getLaunchIntentSenderForPackage(packageName)
            sender.sendIntent(context, 0, null, null, null)
            ExecutionResult(ok = true, data = mapOf("opened" to true, "package" to packageName))
        } catch (e: Exception) {
            ExecutionResult(ok = false, error = "Could not open $packageName: ${e.message ?: e::class.java.simpleName}")
        }
    }
}
