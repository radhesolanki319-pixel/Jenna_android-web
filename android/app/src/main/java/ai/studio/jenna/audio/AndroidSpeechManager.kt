package ai.studio.jenna.audio

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import android.webkit.WebView
import java.util.Locale

class AndroidSpeechManager(
    private val context: Context,
    private val webViewProvider: () -> WebView?
) {
    private var speechRecognizer: SpeechRecognizer? = null
    private var isListening = false
    private var wakeWordDetector: AndroidWakeWordDetector? = null

    fun setWakeWordDetector(detector: AndroidWakeWordDetector) {
        this.wakeWordDetector = detector
    }

    fun startListening(lang: String): Boolean {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            Log.w("JennaSpeech", "Speech recognition not available on this device")
            notifyError("Speech recognition not available on this device.")
            return false
        }

        // Suspend passive wake-word listening while active speech recognition holds the microphone
        wakeWordDetector?.suspend()

        stopListening()

        try {
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
                setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) {
                        Log.d("JennaSpeech", "Ready for speech")
                    }

                    override fun onBeginningOfSpeech() {
                        Log.d("JennaSpeech", "Beginning of speech")
                    }

                    override fun onRmsChanged(rmsdB: Float) {}

                    override fun onBufferReceived(buffer: ByteArray?) {}

                    override fun onEndOfSpeech() {
                        Log.d("JennaSpeech", "End of speech")
                        notifyEnd()
                        // Active speaking ended; resume wake word detection
                        wakeWordDetector?.resume()
                    }

                    override fun onError(error: Int) {
                        val message = when (error) {
                            SpeechRecognizer.ERROR_AUDIO -> "Audio recording error"
                            SpeechRecognizer.ERROR_CLIENT -> "Client side error"
                            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Insufficient permissions"
                            SpeechRecognizer.ERROR_NETWORK -> "Network error"
                            SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network timeout"
                            SpeechRecognizer.ERROR_NO_MATCH -> "No speech recognized"
                            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognition service busy"
                            SpeechRecognizer.ERROR_SERVER -> "Server error"
                            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Speech input timeout"
                            else -> "Recognition error: $error"
                        }
                        Log.w("JennaSpeech", "SpeechRecognizer error: $message")
                        notifyError(message)
                        isListening = false
                        // Resume wake word detector on error
                        wakeWordDetector?.resume()
                    }

                    override fun onResults(results: Bundle?) {
                        val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        val text = matches?.firstOrNull() ?: ""
                        Log.d("JennaSpeech", "Final Speech Result: $text")
                        notifyResult(text, isFinal = true)
                        isListening = false
                        // Finished recognition; resume wake-word detection
                        wakeWordDetector?.resume()
                    }

                    override fun onPartialResults(partialResults: Bundle?) {
                        val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        val text = matches?.firstOrNull() ?: ""
                        Log.d("JennaSpeech", "Partial Speech Result: $text")
                        notifyResult(text, isFinal = false)
                    }

                    override fun onEvent(eventType: Int, params: Bundle?) {}
                })
            }

            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang.ifEmpty { "en-US" })
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            }

            speechRecognizer?.startListening(intent)
            isListening = true
            return true
        } catch (e: Exception) {
            Log.e("JennaSpeech", "Failed to start speech recognizer", e)
            notifyError(e.localizedMessage ?: "Failed to start speech recognition")
            wakeWordDetector?.resume()
            return false
        }
    }

    fun stopListening() {
        try {
            speechRecognizer?.stopListening()
            speechRecognizer?.destroy()
        } catch (e: Exception) {
            Log.w("JennaSpeech", "Error stopping speech recognizer", e)
        } finally {
            speechRecognizer = null
            isListening = false
            wakeWordDetector?.resume()
        }
    }

    private fun notifyResult(text: String, isFinal: Boolean) {
        val sanitized = text.replace("'", "\\'").replace("\n", " ")
        runOnWebThread("if (window.__onJennaAndroidSpeechResult) window.__onJennaAndroidSpeechResult('$sanitized', $isFinal);")
    }

    private fun notifyError(error: String) {
        val sanitized = error.replace("'", "\\'")
        runOnWebThread("if (window.__onJennaAndroidSpeechError) window.__onJennaAndroidSpeechError('$sanitized');")
    }

    private fun notifyEnd() {
        runOnWebThread("if (window.__onJennaAndroidSpeechEnd) window.__onJennaAndroidSpeechEnd();")
    }

    private fun runOnWebThread(jsCode: String) {
        val wv = webViewProvider() ?: return
        wv.post {
            wv.evaluateJavascript(jsCode, null)
        }
    }
}
