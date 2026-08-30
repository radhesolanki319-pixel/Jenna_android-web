package ai.studio.jenna.audio

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log

/**
 * Continuous / Background Voice Service wrapper for Jenna.
 * Delegates seamlessly to JennaBackgroundAssistantService to ensure a unified,
 * singleton-backed background assistant architecture and prevent duplicate listeners.
 */
class JennaContinuousVoiceService : Service() {

    companion object {
        private const val TAG = "JennaContinuousVoice"
        const val ACTION_START = "ai.studio.jenna.action.START_CONTINUOUS_VOICE"
        const val ACTION_STOP = "ai.studio.jenna.action.STOP_CONTINUOUS_VOICE"

        fun isRunning(): Boolean = JennaBackgroundAssistantService.isRunning()

        fun startService(context: Context) {
            Log.d(TAG, "Delegating startService to JennaBackgroundAssistantService")
            JennaBackgroundAssistantService.startService(context)
        }

        fun stopService(context: Context) {
            Log.d(TAG, "Delegating stopService to JennaBackgroundAssistantService")
            JennaBackgroundAssistantService.stopService(context)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_START
        if (action == ACTION_STOP) {
            JennaBackgroundAssistantService.stopService(this)
            stopSelf()
            return START_NOT_STICKY
        }
        JennaBackgroundAssistantService.startService(this)
        stopSelf()
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
