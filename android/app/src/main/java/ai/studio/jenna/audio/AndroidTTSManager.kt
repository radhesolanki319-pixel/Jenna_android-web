package ai.studio.jenna.audio

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import android.webkit.WebView
import java.util.Locale

class AndroidTTSManager(
    private val context: Context,
    private val webViewProvider: () -> WebView?
) : TextToSpeech.OnInitListener {

    private var tts: TextToSpeech? = null
    private var isInitialized = false
    private var wakeWordDetector: AndroidWakeWordDetector? = null

    init {
        tts = TextToSpeech(context.applicationContext, this)
    }

    fun setWakeWordDetector(detector: AndroidWakeWordDetector) {
        this.wakeWordDetector = detector
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            val result = tts?.setLanguage(Locale.US)
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                Log.w("JennaTTS", "Language is not supported for TTS")
            } else {
                isInitialized = true
                Log.d("JennaTTS", "TextToSpeech successfully initialized")
            }

            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {
                    Log.d("JennaTTS", "TTS Utterance started: $utteranceId")
                    wakeWordDetector?.suspend()
                }

                override fun onDone(utteranceId: String?) {
                    Log.d("JennaTTS", "TTS Utterance done: $utteranceId")
                    wakeWordDetector?.resume()
                    notifyFinished()
                }

                override fun onError(utteranceId: String?) {
                    Log.w("JennaTTS", "TTS Utterance error: $utteranceId")
                    wakeWordDetector?.resume()
                    notifyFinished()
                }
            })
        } else {
            Log.e("JennaTTS", "Failed to initialize TextToSpeech engine")
        }
    }

    fun speak(text: String, rate: Float = 1.0f, pitch: Float = 1.0f) {
        if (!isInitialized) {
            Log.w("JennaTTS", "TTS not initialized yet")
            notifyFinished()
            return
        }

        val cleanText = text.replace(Regex("[*_#`\\[\\]()]"), " ").trim()
        if (cleanText.isEmpty()) {
            notifyFinished()
            return
        }

        // Suspend wake-word/continuous listening before audio playback
        wakeWordDetector?.suspend()

        stop()

        tts?.setSpeechRate(rate.coerceIn(0.5f, 2.0f))
        tts?.setPitch(pitch.coerceIn(0.5f, 2.0f))

        val utteranceId = "jenna_utt_${System.currentTimeMillis()}"
        tts?.speak(cleanText, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
    }

    fun stop() {
        try {
            tts?.stop()
        } catch (e: Exception) {
            Log.w("JennaTTS", "Error stopping TTS", e)
        } finally {
            wakeWordDetector?.resume()
        }
    }

    fun shutdown() {
        try {
            tts?.stop()
            tts?.shutdown()
        } catch (e: Exception) {
            Log.w("JennaTTS", "Error shutting down TTS", e)
        } finally {
            tts = null
            isInitialized = false
        }
    }

    private fun notifyFinished() {
        val wv = webViewProvider() ?: return
        wv.post {
            wv.evaluateJavascript("if (window.__onJennaAndroidTTSFinished) window.__onJennaAndroidTTSFinished();", null)
        }
    }
}
