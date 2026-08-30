package ai.studio.jenna.audio

import ai.studio.jenna.MainActivity
import ai.studio.jenna.R
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Android Background Assistant Service for Jenna (Phase 2 #15).
 *
 * Implements a persistent, battery-aware, Android 14+ compliant background assistant service.
 *
 * Core Responsibilities:
 * 1. Manages background wake-word & continuous voice listening loop.
 * 2. Prevents duplicate services, duplicate listeners, and duplicate speech sessions.
 * 3. Manages AudioManager AudioFocus lifecycle (pausing on phone calls/alarms, resuming on focus gain).
 * 4. Provides foreground notification with quick actions ("Open Assistant", "Stop Service").
 * 5. Safely triggers wake-word action dispatch and brings MainActivity to the foreground if needed.
 * 6. Handles full Android lifecycle, interruptions, and clean teardown.
 */
class JennaBackgroundAssistantService : Service(), AudioManager.OnAudioFocusChangeListener {

    enum class ServiceState {
        STOPPED,
        STARTING,
        LISTENING,
        PAUSED,
        STOPPING
    }

    companion object {
        private const val TAG = "JennaBgAssistant"
        private const val CHANNEL_ID = "jenna_background_assistant_channel"
        private const val NOTIFICATION_ID = 2002

        const val ACTION_START = "ai.studio.jenna.action.START_BACKGROUND_ASSISTANT"
        const val ACTION_STOP = "ai.studio.jenna.action.STOP_BACKGROUND_ASSISTANT"
        const val ACTION_PAUSE = "ai.studio.jenna.action.PAUSE_BACKGROUND_ASSISTANT"
        const val ACTION_RESUME = "ai.studio.jenna.action.RESUME_BACKGROUND_ASSISTANT"
        const val ACTION_TRIGGER = "ai.studio.jenna.action.TRIGGER_ASSISTANT"

        private val isRunningFlag = AtomicBoolean(false)
        private var currentState: ServiceState = ServiceState.STOPPED
        private var instance: JennaBackgroundAssistantService? = null

        fun isRunning(): Boolean = isRunningFlag.get()

        fun getState(): ServiceState = currentState

        fun startService(context: Context) {
            if (isRunningFlag.get() && currentState == ServiceState.LISTENING) {
                Log.d(TAG, "Background Assistant Service is already running and listening.")
                return
            }

            val intent = Intent(context, JennaBackgroundAssistantService::class.java).apply {
                action = ACTION_START
            }

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start JennaBackgroundAssistantService", e)
            }
        }

        fun stopService(context: Context) {
            val intent = Intent(context, JennaBackgroundAssistantService::class.java).apply {
                action = ACTION_STOP
            }
            try {
                context.startService(intent)
            } catch (e: Exception) {
                Log.w(TAG, "Error requesting stop on JennaBackgroundAssistantService", e)
            }
        }
    }

    private var audioManager: AudioManager? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var hasAudioFocus: Boolean = false
    private var wakeWordDetector: AndroidWakeWordDetector? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onCreate() {
        super.onCreate()
        instance = this
        audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        createNotificationChannel()
        initializeWakeWordDetector()
        Log.i(TAG, "JennaBackgroundAssistantService onCreate initialized")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_START
        Log.d(TAG, "onStartCommand received action: $action (startId: $startId)")

        when (action) {
            ACTION_STOP -> {
                Log.i(TAG, "Received ACTION_STOP, tearing down service cleanly")
                stopAssistantService()
                return START_NOT_STICKY
            }
            ACTION_PAUSE -> {
                pauseListening("User requested pause")
                return START_STICKY
            }
            ACTION_RESUME -> {
                resumeListening("User requested resume")
                return START_STICKY
            }
            ACTION_TRIGGER -> {
                handleAssistantTrigger()
                return START_STICKY
            }
            ACTION_START -> {
                startForegroundAssistant()
                return START_STICKY
            }
        }

        return START_STICKY
    }

    private fun startForegroundAssistant() {
        if (isRunningFlag.get() && currentState == ServiceState.LISTENING) {
            Log.d(TAG, "Service is already in active listening state.")
            return
        }

        currentState = ServiceState.STARTING
        isRunningFlag.set(true)

        val notification = buildForegroundNotification("Jenna Voice Assistant Active", "Listening for \"Hey Jenna\"...")

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                    )
                } else {
                    startForeground(NOTIFICATION_ID, notification)
                }
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to startForeground on Background Assistant Service", e)
        }

        requestAudioFocusAndListen()
    }

    private fun initializeWakeWordDetector() {
        if (wakeWordDetector != null) return

        wakeWordDetector = AndroidWakeWordDetector(
            context = applicationContext,
            webViewProvider = { null },
            onWakeWordDetected = { keyword ->
                Log.i(TAG, "Wake-word triggered from background service: $keyword")
                handleWakeWordDetectedInBackground(keyword)
            }
        )
    }

    private fun requestAudioFocusAndListen() {
        val am = audioManager
        if (am == null) {
            startWakeWordLoop()
            return
        }

        val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val playbackAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()

            val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(playbackAttributes)
                .setAcceptsDelayedFocusGain(true)
                .setOnAudioFocusChangeListener(this, mainHandler)
                .build()

            this.audioFocusRequest = focusRequest
            am.requestAudioFocus(focusRequest)
        } else {
            @Suppress("DEPRECATION")
            am.requestAudioFocus(
                this,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
            )
        }

        if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            hasAudioFocus = true
            startWakeWordLoop()
        } else {
            hasAudioFocus = false
            Log.w(TAG, "Audio focus request not granted immediately ($result), waiting...")
            currentState = ServiceState.PAUSED
        }
    }

    private fun startWakeWordLoop() {
        currentState = ServiceState.LISTENING
        wakeWordDetector?.setContinuousMode(true)
        wakeWordDetector?.start()
        Log.i(TAG, "Background Assistant Service is now actively listening.")
    }

    private fun pauseListening(reason: String) {
        Log.i(TAG, "Pausing background assistant listening: $reason")
        currentState = ServiceState.PAUSED
        wakeWordDetector?.suspend()
        updateNotification("Jenna Voice Assistant Paused", reason)
    }

    private fun resumeListening(reason: String) {
        if (currentState == ServiceState.STOPPED || currentState == ServiceState.STOPPING) return
        Log.i(TAG, "Resuming background assistant listening: $reason")
        currentState = ServiceState.LISTENING
        wakeWordDetector?.resume()
        updateNotification("Jenna Voice Assistant Active", "Listening for \"Hey Jenna\"...")
    }

    private fun handleWakeWordDetectedInBackground(keyword: String) {
        triggerHapticFeedback()

        // Launch MainActivity with ACTION_VOICE_COMMAND intent
        try {
            val launchIntent = Intent(this, MainActivity::class.java).apply {
                action = Intent.ACTION_VOICE_COMMAND
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(Intent.EXTRA_TEXT, keyword)
                putExtra("ai.studio.jenna.extra.WAKE_WORD_TRIGGER", true)
            }
            startActivity(launchIntent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch MainActivity on wake-word trigger", e)
        }
    }

    private fun handleAssistantTrigger() {
        triggerHapticFeedback()
        try {
            val launchIntent = Intent(this, MainActivity::class.java).apply {
                action = Intent.ACTION_ASSIST
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            startActivity(launchIntent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch MainActivity on assistant trigger", e)
        }
    }

    private fun triggerHapticFeedback() {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vm?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }

            if (vibrator != null && vibrator.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(30L, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    vibrator.vibrate(30L)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Haptic feedback on assistant wake failed", e)
        }
    }

    override fun onAudioFocusChange(focusChange: Int) {
        Log.d(TAG, "onAudioFocusChange: $focusChange")
        when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS -> {
                hasAudioFocus = false
                pauseListening("Audio focus lost to another application")
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                hasAudioFocus = false
                pauseListening("Transient audio interruption (call/navigation)")
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                hasAudioFocus = true
                resumeListening("Audio focus regained")
            }
        }
    }

    private fun abandonAudioFocus() {
        if (!hasAudioFocus) return
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                audioFocusRequest?.let { audioManager?.abandonAudioFocusRequest(it) }
            } else {
                @Suppress("DEPRECATION")
                audioManager?.abandonAudioFocus(this)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error abandoning audio focus", e)
        } finally {
            hasAudioFocus = false
            audioFocusRequest = null
        }
    }

    private fun buildForegroundNotification(title: String, content: String): Notification {
        val launchIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = Intent(this, JennaBackgroundAssistantService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPendingIntent = PendingIntent.getService(
            this,
            1,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(content)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(0, "Open Jenna", pendingIntent)
            .addAction(0, "Stop Assistant", stopPendingIntent)
            .build()
    }

    private fun updateNotification(title: String, content: String) {
        try {
            val notification = buildForegroundNotification(title, content)
            val manager = getSystemService(NotificationManager::class.java)
            manager?.notify(NOTIFICATION_ID, notification)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to update notification", e)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Jenna Background Assistant",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Background listening and wake-word assistant notifications for Jenna"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun stopAssistantService() {
        currentState = ServiceState.STOPPING
        isRunningFlag.set(false)

        try {
            wakeWordDetector?.stop()
            wakeWordDetector = null
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping wake word detector", e)
        }

        abandonAudioFocus()

        try {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping foreground service", e)
        } finally {
            currentState = ServiceState.STOPPED
            Log.i(TAG, "JennaBackgroundAssistantService completely stopped")
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        stopAssistantService()
        instance = null
        Log.i(TAG, "JennaBackgroundAssistantService onDestroy complete")
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        Log.i(TAG, "JennaBackgroundAssistantService onTaskRemoved")
        // If user intentionally swiped away app from recents and continuous mode is NOT forced sticky, stop cleanly
        if (!wakeWordDetector?.isContinuousMode()!!) {
            stopAssistantService()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
