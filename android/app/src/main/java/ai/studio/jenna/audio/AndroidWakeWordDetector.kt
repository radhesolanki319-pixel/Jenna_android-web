package ai.studio.jenna.audio

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import android.webkit.WebView
import java.util.Locale

/**
 * Android Wake-word Detector for Jenna.
 *
 * Implements low-overhead, resilient passive wake-word detection ("Hey Jenna" / "Jenna")
 * using the Android SpeechRecognizer architecture.
 *
 * Key Capabilities:
 * - Continuous listening loop with automatic recovery on silence/timeout.
 * - Robust keyword matching with phonetic tolerance ("hey jenna", "hi jenna", "ok jenna", "jenna").
 * - Lifecycle synchronization: automatically yields microphone when active STT or speech is in progress.
 * - Native bridge dispatch to notify JavaScript/WebView with haptic/visual feedback.
 */
class AndroidWakeWordDetector(
    private val context: Context,
    private val webViewProvider: () -> WebView?,
    private val onWakeWordDetected: ((keyword: String) -> Unit)? = null
) {
    companion object {
        private const val TAG = "JennaWakeWord"
        private const val DEFAULT_KEYWORD = "Hey Jenna"
        private const val RESTART_DELAY_MS = 500L
        private const val MAX_CONSECUTIVE_ERRORS = 5
    }

    private var speechRecognizer: SpeechRecognizer? = null
    private var isEnabled: Boolean = false
    private var isContinuousMode: Boolean = false
    private var isRunning: Boolean = false
    private var isSuspended: Boolean = false // Temporarily paused while user is actively talking (STT) or TTS is playing
    private var consecutiveErrors = 0
    private val mainHandler = Handler(Looper.getMainLooper())

    private val wakeKeywords = listOf(
        "hey jenna",
        "hi jenna",
        "ok jenna",
        "okay jenna",
        "hello jenna",
        "jenna",
        "giga", // Phonetic variant sometimes heard on certain STT models
        "jena",
        "genna"
    )

    fun setEnabled(enabled: Boolean) {
        this.isEnabled = enabled
        Log.i(TAG, "Wake-word detector setEnabled: $enabled")
        if (enabled || isContinuousMode) {
            if (!isRunning && !isSuspended) {
                startDetector()
            }
        } else {
            stopDetector()
        }
    }

    fun isEnabled(): Boolean = isEnabled || isContinuousMode

    fun setContinuousMode(enabled: Boolean) {
        this.isContinuousMode = enabled
        Log.i(TAG, "Continuous voice mode setContinuousMode: $enabled")
        if (enabled) {
            this.isEnabled = true
            if (!isRunning && !isSuspended) {
                startDetector()
            }
        } else if (!isEnabled) {
            stopDetector()
        }
    }

    fun isContinuousMode(): Boolean = isContinuousMode

    fun isListening(): Boolean = isRunning && !isSuspended

    /**
     * Temporarily suspends wake-word detection so active STT (voice input) or TTS audio playback can use the microphone/audio channel cleanly.
     */
    fun suspend() {
        if (!isEnabled || isSuspended) return
        Log.d(TAG, "Suspending wake-word detector")
        isSuspended = true
        stopRecognizer()
    }

    /**
     * Resumes wake-word detection after active STT or TTS has finished.
     */
    fun resume() {
        if (!isEnabled || !isSuspended) return
        Log.d(TAG, "Resuming wake-word detector")
        isSuspended = false
        consecutiveErrors = 0
        mainHandler.postDelayed({
            if (isEnabled && !isSuspended && !isRunning) {
                startDetector()
            }
        }, RESTART_DELAY_MS)
    }

    fun start(): Boolean {
        isEnabled = true
        return startDetector()
    }

    fun stop() {
        isEnabled = false
        stopDetector()
    }

    private fun startDetector(): Boolean {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            Log.w(TAG, "SpeechRecognizer is not available on this device for wake-word detection")
            return false
        }

        if (isRunning) return true

        try {
            stopRecognizer()

            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
                setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) {
                        Log.d(TAG, "WakeWord recognizer ready")
                        consecutiveErrors = 0
                    }

                    override fun onBeginningOfSpeech() {
                        Log.d(TAG, "WakeWord audio energy detected")
                    }

                    override fun onRmsChanged(rmsdB: Float) {}

                    override fun onBufferReceived(buffer: ByteArray?) {}

                    override fun onEndOfSpeech() {
                        Log.d(TAG, "WakeWord audio buffer ended")
                    }

                    override fun onError(error: Int) {
                        Log.d(TAG, "WakeWord recognition cycle ended with code: $error")
                        // Silence/timeout (ERROR_NO_MATCH or ERROR_SPEECH_TIMEOUT) is normal during passive listening
                        if (error != SpeechRecognizer.ERROR_NO_MATCH && error != SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                            consecutiveErrors++
                        }

                        // Schedule the next listening loop if still active
                        scheduleRestart()
                    }

                    override fun onResults(results: Bundle?) {
                        val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        if (matches != null) {
                            checkWakeWordMatches(matches)
                        }
                        scheduleRestart()
                    }

                    override fun onPartialResults(partialResults: Bundle?) {
                        val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        if (matches != null) {
                            if (checkWakeWordMatches(matches)) {
                                // Triggered on partial result for fastest reaction time
                                stopRecognizer()
                                scheduleRestart()
                            }
                        }
                    }

                    override fun onEvent(eventType: Int, params: Bundle?) {}
                })
            }

            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.US.toString())
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                // Low latency flags
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 1000L)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1000L)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1000L)
            }

            speechRecognizer?.startListening(intent)
            isRunning = true
            Log.i(TAG, "Wake-word detection loop active")
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start wake-word detector", e)
            isRunning = false
            consecutiveErrors++
            scheduleRestart()
            return false
        }
    }

    private fun checkWakeWordMatches(candidates: List<String>): Boolean {
        for (phrase in candidates) {
            val normalized = phrase.trim().lowercase(Locale.ROOT)
            Log.d(TAG, "Evaluating wake-word phrase: '$normalized'")
            
            val matched = wakeKeywords.any { kw ->
                normalized == kw ||
                normalized.startsWith("$kw ") ||
                normalized.endsWith(" $kw") ||
                normalized.contains(" $kw ")
            }

            if (matched) {
                Log.i(TAG, "✨ Wake-word MATCH DETECTED: '$phrase' -> Triggering Jenna Assistant")
                handleWakeWordTriggered(DEFAULT_KEYWORD)
                return true
            }
        }
        return false
    }

    private fun handleWakeWordTriggered(keyword: String) {
        // Temporarily suspend detector to yield to STT
        suspend()

        // Call Kotlin callback if registered
        onWakeWordDetected?.invoke(keyword)

        // Post event to WebView JavaScript layer
        val sanitized = keyword.replace("'", "\\'")
        runOnWebThread("if (window.__onJennaAndroidWakeWordDetected) window.__onJennaAndroidWakeWordDetected('$sanitized');")
    }

    private fun scheduleRestart() {
        isRunning = false
        stopRecognizer()

        if (!isEnabled || isSuspended) {
            return
        }

        // Backoff slightly if too many consecutive errors
        val delay = if (consecutiveErrors > MAX_CONSECUTIVE_ERRORS) {
            RESTART_DELAY_MS * 4
        } else {
            RESTART_DELAY_MS
        }

        mainHandler.postDelayed({
            if (isEnabled && !isSuspended && !isRunning) {
                startDetector()
            }
        }, delay)
    }

    private fun stopRecognizer() {
        try {
            speechRecognizer?.stopListening()
            speechRecognizer?.cancel()
            speechRecognizer?.destroy()
        } catch (e: Exception) {
            Log.w(TAG, "Error cleaning up SpeechRecognizer", e)
        } finally {
            speechRecognizer = null
        }
    }

    private fun stopDetector() {
        isRunning = false
        mainHandler.removeCallbacksAndMessages(null)
        stopRecognizer()
        Log.i(TAG, "Wake-word detector stopped")
    }

    private fun runOnWebThread(jsCode: String) {
        val wv = webViewProvider() ?: return
        wv.post {
            wv.evaluateJavascript(jsCode, null)
        }
    }
}
