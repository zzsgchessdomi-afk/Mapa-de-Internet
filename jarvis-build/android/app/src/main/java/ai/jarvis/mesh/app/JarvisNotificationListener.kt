package ai.jarvis.mesh.app

import android.service.notification.NotificationListenerService

/**
 * Grants JARVIS access to the user's active media sessions only after the user
 * explicitly enables Notification Access in Android settings.
 */
class JarvisNotificationListener : NotificationListenerService()
