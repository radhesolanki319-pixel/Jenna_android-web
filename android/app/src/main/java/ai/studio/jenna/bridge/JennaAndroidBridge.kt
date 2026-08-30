package ai.studio.jenna.bridge

import ai.studio.jenna.audio.AndroidAudioPlayer
import ai.studio.jenna.audio.AndroidSpeechManager
import ai.studio.jenna.audio.AndroidTTSManager
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
import android.widget.Toast
import kotlinx.coroutines.runBlocking
import org.json.JSONObject

class JennaAndroidBridge(
    private val context: Context,
    private val repository: JennaDataRepository,
    private val speechManager: AndroidSpeechManager,
    private val ttsManager: AndroidTTSManager,
    private val audioPlayer: AndroidAudioPlayer,
    private val onExitRequested: (() -> Unit)? = null
) {
    private var isWakeWordEnabled = true
    private var isBackIntercepted = false
    private var initialIntentJson = "{}"
    private val mainHandler = Handler(Looper.getMainLooper())

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
    // Wake-Word Status & Control APIs
    // ----------------------------------------------------
    @JavascriptInterface
    fun getWakeWordStatus(): String {
        val obj = JSONObject().apply {
            put("enabled", isWakeWordEnabled)
            put("isListening", false) // Passive wake word engine state
            put("keyword", "Hey Jenna")
        }
        return obj.toString()
    }

    @JavascriptInterface
    fun setWakeWordEnabled(enabled: Boolean) {
        this.isWakeWordEnabled = enabled
        Log.i("JennaBridge", "Wake-word detection status updated: $enabled")
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
