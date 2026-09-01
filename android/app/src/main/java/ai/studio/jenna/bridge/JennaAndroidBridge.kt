package ai.studio.jenna.bridge

import ai.studio.jenna.audio.AndroidAudioPlayer
import ai.studio.jenna.audio.AndroidSpeechManager
import ai.studio.jenna.audio.AndroidTTSManager
import ai.studio.jenna.audio.AndroidWakeWordDetector
import ai.studio.jenna.data.repository.JennaDataRepository
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.json.JSONObject

class JennaAndroidBridge(
    private val context: Context,
    private val repository: JennaDataRepository,
    private val speechManager: AndroidSpeechManager,
    private val ttsManager: AndroidTTSManager,
    private val audioPlayer: AndroidAudioPlayer,
    private val wakeWordDetector: AndroidWakeWordDetector,
    private val onExitRequested: (() -> Unit)? = null
) {
    private var isBackIntercepted = false
    private var initialIntentJson = "{}"
    private val mainHandler = Handler(Looper.getMainLooper())

    // ----------------------------------------------------
    // Async Bridge v2 (Jarvis Phase 2 — WS6)
    //
    // The legacy sync methods below use runBlocking, which stalls the WebView's
    // JavaScript bridge thread on Room I/O. requestAsync() runs the same
    // operations on Dispatchers.IO and delivers the result back to JS via
    // window.__onJennaAndroidAsyncResult(requestId, ok, payloadJson).
    // The sync methods are kept for backwards compatibility with older web builds.
    // ----------------------------------------------------
    private val bridgeScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var webViewProvider: (() -> WebView?)? = null

    fun setWebViewProvider(provider: () -> WebView?) {
        this.webViewProvider = provider
    }

    fun destroy() {
        bridgeScope.cancel()
    }

    private fun postAsyncResult(requestId: String, ok: Boolean, payloadJson: String) {
        val safeId = JSONObject.quote(requestId)
        val safePayload = JSONObject.quote(payloadJson)
        mainHandler.post {
            webViewProvider?.invoke()?.evaluateJavascript(
                "if (window.__onJennaAndroidAsyncResult) { window.__onJennaAndroidAsyncResult($safeId, $ok, $safePayload); }",
                null
            )
        }
    }

    /**
     * Generic async entry point. `method` selects the operation; `paramsJson` carries
     * its arguments. The result (or error) is delivered asynchronously to
     * window.__onJennaAndroidAsyncResult — the caller thread is never blocked.
     */
    @JavascriptInterface
    fun requestAsync(requestId: String, method: String, paramsJson: String) {
        bridgeScope.launch {
            try {
                val params = try { JSONObject(paramsJson) } catch (e: Exception) { JSONObject() }
                val result: String = when (method) {
                    "getConversations" -> repository.getConversationsJson()
                    "saveConversation" -> { repository.saveConversationJson(params.optString("json", "{}")); "{}" }
                    "deleteConversation" -> { repository.deleteConversation(params.optString("id")); "{}" }
                    "getMessages" -> repository.getMessagesJson(params.optString("conversationId"))
                    "saveMessages" -> {
                        repository.saveMessagesJson(params.optString("conversationId"), params.optString("json", "[]")); "{}"
                    }
                    "getMemories" -> repository.getMemoriesJson()
                    "saveMemory" -> { repository.saveMemoryJson(params.optString("json", "{}")); "{}" }
                    "deleteMemory" -> { repository.deleteMemory(params.optString("id")); "{}" }
                    "clearAllMemories" -> { repository.clearAllMemories(); "{}" }
                    "getUserIdentity" -> repository.getUserIdentityJson() ?: "{}"
                    "saveUserIdentity" -> repository.saveUserIdentityJson(params.optString("json", "{}"))
                    "getSettings" -> repository.getSettingsJson() ?: "{}"
                    "saveSettings" -> { repository.saveSettingsJson(params.optString("json", "{}")); "{}" }
                    else -> throw IllegalArgumentException("Unknown async bridge method: $method")
                }
                postAsyncResult(requestId, true, result)
            } catch (e: Exception) {
                Log.e("JennaBridge", "Async bridge error for $method", e)
                postAsyncResult(requestId, false, JSONObject().put("error", e.message ?: "unknown error").toString())
            }
        }
    }

    fun setInitialIntentJson(json: String) {
        this.initialIntentJson = json
    }

    fun isBackIntercepted(): Boolean = isBackIntercepted

    // ----------------------------------------------------
    // Storage APIs (Room Database)
    // ----------------------------------------------------
    @JavascriptInterface
    fun getConversations(): String = runBlocking {
        try {
            repository.getConversationsJson()
        } catch (e: Exception) {
            Log.e("JennaBridge", "Error getting conversations", e)
            "[]"
        }
    }

    @JavascriptInterface
    fun saveConversation(json: String) = runBlocking {
        try {
            repository.saveConversationJson(json)
        } catch (e: Exception) {
            Log.e("JennaBridge", "Error saving conversation", e)
        }
    }

    @JavascriptInterface
    fun deleteConversation(id: String) = runBlocking {
        try {
            repository.deleteConversation(id)
        } catch (e: Exception) {
            Log.e("JennaBridge", "Error deleting conversation", e)
        }
    }

    @JavascriptInterface
    fun getMessages(conversationId: String): String = runBlocking {
        try {
            repository.getMessagesJson(conversationId)
        } catch (e: Exception) {
            Log.e("JennaBridge", "Error getting messages for $conversationId", e)
            "[]"
        }
    }

    @JavascriptInterface
    fun saveMessages(conversationId: String, json: String) = runBlocking {
        try {
            repository.saveMessagesJson(conversationId, json)
        } catch (e: Exception) {
            Log.e("JennaBridge", "Error saving messages for $conversationId", e)
        }
    }

    @JavascriptInterface
    fun getMemories(): String = runBlocking {
        try {
            repository.getMemoriesJson()
        } catch (e: Exception) {
            Log.e("JennaBridge", "Error getting memories", e)
            "[]"
        }
    }

    @JavascriptInterface
    fun saveMemory(json: String) = runBlocking {
        try {
            repository.saveMemoryJson(json)
        } catch (e: Exception) {
            Log.e("JennaBridge", "Error saving memory", e)
        }
    }

    @JavascriptInterface
    fun deleteMemory(id: String) = runBlocking {
        try {
            repository.deleteMemory(id)
        } catch (e: Exception) {
            Log.e("JennaBridge", "Error deleting memory", e)
        }
    }

    @JavascriptInterface
    fun clearAllMemories() = runBlocking {
        try {
            repository.clearAllMemories()
        } catch (e: Exception) {
            Log.e("JennaBridge", "Error clearing memories", e)
        }
    }

    @JavascriptInterface
    fun getUserIdentity(): String = runBlocking {
        try {
            repository.getUserIdentityJson() ?: "{}"
        } catch (e: Exception) {
            Log.e("JennaBridge", "Error getting user identity", e)
            "{}"
        }
    }

    @JavascriptInterface
    fun saveUserIdentity(json: String): String = runBlocking {
        try {
            repository.saveUserIdentityJson(json)
        } catch (e: Exception) {
            Log.e("JennaBridge", "Error saving user identity", e)
            json
        }
    }

    @JavascriptInterface
    fun getSettings(): String = runBlocking {
        try {
            repository.getSettingsJson() ?: "{}"
        } catch (e: Exception) {
            Log.e("JennaBridge", "Error getting settings", e)
            "{}"
        }
    }

    @JavascriptInterface
    fun saveSettings(json: String) = runBlocking {
        try {
            repository.saveSettingsJson(json)
        } catch (e: Exception) {
            Log.e("JennaBridge", "Error saving settings", e)
        }
    }

    // ----------------------------------------------------
    // Speech & Audio APIs
    // ----------------------------------------------------
    @JavascriptInterface
    fun startSpeechRecognition(lang: String): Boolean {
        return speechManager.startListening(lang)
    }

    @JavascriptInterface
    fun stopSpeechRecognition() {
        speechManager.stopListening()
    }

    @JavascriptInterface
    fun speakNativeTTS(text: String, rate: Float, pitch: Float) {
        ttsManager.speak(text, rate, pitch)
    }

    @JavascriptInterface
    fun stopTTS() {
        ttsManager.stop()
    }

    @JavascriptInterface
    fun playBase64Audio(base64Data: String, mimeType: String): Boolean {
        return audioPlayer.playBase64(base64Data, mimeType)
    }

    @JavascriptInterface
    fun stopAudio() {
        audioPlayer.stop()
    }

    // ----------------------------------------------------
    // Wake-Word & Continuous Voice Status & Control APIs
    // ----------------------------------------------------
    @JavascriptInterface
    fun getWakeWordStatus(): String {
        val obj = JSONObject().apply {
            put("enabled", wakeWordDetector.isEnabled())
            put("isListening", wakeWordDetector.isListening())
            put("keyword", "Hey Jenna")
        }
        return obj.toString()
    }

    @JavascriptInterface
    fun setWakeWordEnabled(enabled: Boolean) {
        wakeWordDetector.setEnabled(enabled)
        Log.i("JennaBridge", "Wake-word detection status updated: $enabled")
    }

    @JavascriptInterface
    fun setContinuousVoiceEnabled(enabled: Boolean) {
        wakeWordDetector.setContinuousMode(enabled)
        if (enabled) {
            ai.studio.jenna.audio.JennaBackgroundAssistantService.startService(context)
        } else {
            ai.studio.jenna.audio.JennaBackgroundAssistantService.stopService(context)
        }
        Log.i("JennaBridge", "Continuous / Background Voice mode updated: $enabled")
    }

    @JavascriptInterface
    fun getContinuousVoiceStatus(): String {
        val isServiceRunning = ai.studio.jenna.audio.JennaBackgroundAssistantService.isRunning()
        val obj = JSONObject().apply {
            put("enabled", wakeWordDetector.isContinuousMode() || isServiceRunning)
            put("isListening", wakeWordDetector.isListening() || (isServiceRunning && ai.studio.jenna.audio.JennaBackgroundAssistantService.getState() == ai.studio.jenna.audio.JennaBackgroundAssistantService.ServiceState.LISTENING))
            put("isBackgroundActive", isServiceRunning)
            put("serviceState", ai.studio.jenna.audio.JennaBackgroundAssistantService.getState().name)
        }
        return obj.toString()
    }

    @JavascriptInterface
    fun setBackgroundAssistantEnabled(enabled: Boolean) {
        setContinuousVoiceEnabled(enabled)
    }

    @JavascriptInterface
    fun getBackgroundAssistantStatus(): String {
        return getContinuousVoiceStatus()
    }

    // ----------------------------------------------------
    // Back Navigation & Activity Control APIs
    // ----------------------------------------------------
    @JavascriptInterface
    fun setBackIntercepted(intercepted: Boolean) {
        this.isBackIntercepted = intercepted
    }

    @JavascriptInterface
    fun exitApp() {
        mainHandler.post {
            onExitRequested?.invoke()
        }
    }

    // ----------------------------------------------------
    // Intent Routing & Deep Link APIs
    // ----------------------------------------------------
    @JavascriptInterface
    fun getInitialIntent(): String {
        return initialIntentJson
    }

    @JavascriptInterface
    fun openExternalUrl(url: String): Boolean {
        return try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(intent)
            true
        } catch (e: Exception) {
            Log.e("JennaBridge", "Failed to open external url: $url", e)
            false
        }
    }

    @JavascriptInterface
    fun shareText(text: String, title: String?): Boolean {
        return try {
            val sendIntent = Intent().apply {
                action = Intent.ACTION_SEND
                putExtra(Intent.EXTRA_TEXT, text)
                putExtra(Intent.EXTRA_TITLE, title ?: "Jenna AI Assistant")
                type = "text/plain"
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            val shareIntent = Intent.createChooser(sendIntent, title ?: "Share via")
            shareIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            context.startActivity(shareIntent)
            true
        } catch (e: Exception) {
            Log.e("JennaBridge", "Failed to share text", e)
            false
        }
    }

    // ----------------------------------------------------
    // System / Hardware APIs
    // ----------------------------------------------------
    @JavascriptInterface
    fun showToast(message: String, isLong: Boolean) {
        mainHandler.post {
            Toast.makeText(
                context,
                message,
                if (isLong) Toast.LENGTH_LONG else Toast.LENGTH_SHORT
            ).show()
        }
    }

    @JavascriptInterface
    fun vibrate(patternType: String) {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vibratorManager?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }

            if (vibrator != null && vibrator.hasVibrator()) {
                val duration = when (patternType) {
                    "heavy" -> 40L
                    "medium" -> 25L
                    "success" -> 15L
                    else -> 10L
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    vibrator.vibrate(duration)
                }
            }
        } catch (e: Exception) {
            Log.w("JennaBridge", "Vibration failed", e)
        }
    }

    @JavascriptInterface
    fun getDeviceInfo(): String {
        val obj = JSONObject().apply {
            put("platform", "android")
            put("brand", Build.BRAND)
            put("model", Build.MODEL)
            put("sdkVersion", Build.VERSION.SDK_INT)
            put("appVersion", "1.0.0")
        }
        return obj.toString()
    }
}
