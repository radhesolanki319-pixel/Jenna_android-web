package ai.studio.jenna

import ai.studio.jenna.audio.AndroidAudioPlayer
import ai.studio.jenna.audio.AndroidSpeechManager
import ai.studio.jenna.audio.AndroidTTSManager
import ai.studio.jenna.audio.AndroidWakeWordDetector
import ai.studio.jenna.bridge.JennaAndroidBridge
import ai.studio.jenna.data.db.JennaDatabase
import ai.studio.jenna.data.repository.JennaDataRepository
import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar

    private lateinit var database: JennaDatabase
    private lateinit var repository: JennaDataRepository
    private lateinit var speechManager: AndroidSpeechManager
    private lateinit var ttsManager: AndroidTTSManager
    private lateinit var audioPlayer: AndroidAudioPlayer
    private lateinit var wakeWordDetector: AndroidWakeWordDetector
    private lateinit var bridge: JennaAndroidBridge
    private var isWebPageLoaded = false

    companion object {
        private const val TAG = "MainActivity"
        private const val PERMISSION_REQUEST_RECORD_AUDIO = 101
        // URL for development and production hosting
        private const val APP_URL = "http://10.0.2.2:3000" // Standard Android emulator localhost host loopback
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        progressBar = findViewById(R.id.progressBar)

        initServices()
        handleIncomingIntent(intent)
        checkAudioPermission()
        setupWebView()
        setupBackNavigation()

        // Load Jenna Assistant
        webView.loadUrl(APP_URL)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    private fun handleIncomingIntent(intent: Intent?) {
        if (intent == null) return

        try {
            val action = intent.action ?: Intent.ACTION_MAIN
            val payload = JSONObject().apply {
                put("action", action)
                put("type", intent.type ?: "")
                if (intent.data != null) {
                    put("data", intent.dataString)
                }

                // Handle text sharing or assistant voice queries
                if (Intent.ACTION_SEND == action && intent.type?.startsWith("text/") == true) {
                    val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT) ?: ""
                    put("text", sharedText)
                } else if (Intent.ACTION_VOICE_COMMAND == action || Intent.ACTION_ASSIST == action) {
                    val query = intent.getStringExtra(Intent.EXTRA_TEXT) ?: ""
                    put("text", query)
                }

                // Extract any additional string extras
                val extrasObj = JSONObject()
                intent.extras?.keySet()?.forEach { key ->
                    val value = intent.extras?.get(key)
                    if (value is String) {
                        extrasObj.put(key, value)
                    }
                }
                put("extras", extrasObj)
            }

            val payloadJson = payload.toString()
            bridge.setInitialIntentJson(payloadJson)

            // If web page is already ready, deliver real-time intent event
            if (isWebPageLoaded) {
                runOnUiThread {
                    webView.evaluateJavascript(
                        "if (window.__onJennaAndroidIntent) { window.__onJennaAndroidIntent($payloadJson); }",
                        null
                    )
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse incoming intent", e)
        }
    }

    private fun initServices() {
        database = JennaDatabase.getInstance(this)
        repository = JennaDataRepository(database)
        speechManager = AndroidSpeechManager(this) { webView }
        ttsManager = AndroidTTSManager(this) { webView }
        audioPlayer = AndroidAudioPlayer(this) { webView }
        wakeWordDetector = AndroidWakeWordDetector(this, { webView })

        // Cross-wire speech manager, TTS manager, and wake word detector
        speechManager.setWakeWordDetector(wakeWordDetector)
        ttsManager.setWakeWordDetector(wakeWordDetector)

        bridge = JennaAndroidBridge(
            context = this,
            repository = repository,
            speechManager = speechManager,
            ttsManager = ttsManager,
            audioPlayer = audioPlayer,
            wakeWordDetector = wakeWordDetector,
            onExitRequested = { finish() }
        )
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "${userAgentString} JennaAndroid/1.0.0"
        }

        // Expose Jenna Android JavascriptInterface to WebView
        webView.addJavascriptInterface(bridge, "JennaAndroid")
        webView.addJavascriptInterface(bridge, "Android")

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                request?.let {
                    val requestedResources = it.resources
                    for (r in requestedResources) {
                        if (r == PermissionRequest.RESOURCE_AUDIO_CAPTURE) {
                            it.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                            return
                        }
                    }
                    it.grant(requestedResources)
                }
            }

            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (newProgress < 100) {
                    progressBar.visibility = View.VISIBLE
                    progressBar.progress = newProgress
                } else {
                    progressBar.visibility = View.GONE
                }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                progressBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                progressBar.visibility = View.GONE
                isWebPageLoaded = true

                // Dispatch any initial intent that arrived during startup
                handleIncomingIntent(intent)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    progressBar.visibility = View.GONE
                }
            }
        }
    }

    private fun checkAudioPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.RECORD_AUDIO),
                PERMISSION_REQUEST_RECORD_AUDIO
            )
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_RECORD_AUDIO) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Microphone permission enabled", Toast.LENGTH_SHORT).show()
                if (wakeWordDetector.isEnabled()) {
                    wakeWordDetector.start()
                }
            }
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Coordinate with Web layer first for modal dismissals / active speech termination
                webView.evaluateJavascript(
                    "if (typeof window.__onJennaAndroidBackPressed === 'function') { window.__onJennaAndroidBackPressed(); } else { false; }"
                ) { result ->
                    val handledInWeb = result == "true" || result == "\"true\""
                    if (!handledInWeb) {
                        if (webView.canGoBack()) {
                            webView.goBack()
                        } else {
                            isEnabled = false
                            onBackPressedDispatcher.onBackPressed()
                        }
                    }
                }
            }
        })
    }

    override fun onResume() {
        super.onResume()
        if (wakeWordDetector.isEnabled() || wakeWordDetector.isContinuousMode() || ai.studio.jenna.audio.JennaBackgroundAssistantService.isRunning()) {
            wakeWordDetector.resume()
        }
    }

    override fun onPause() {
        super.onPause()
        if (!wakeWordDetector.isContinuousMode() && !ai.studio.jenna.audio.JennaBackgroundAssistantService.isRunning()) {
            wakeWordDetector.suspend()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (!wakeWordDetector.isContinuousMode()) {
            ai.studio.jenna.audio.JennaBackgroundAssistantService.stopService(this)
        }
        wakeWordDetector.stop()
        speechManager.stopListening()
        ttsManager.shutdown()
        audioPlayer.stop()
        webView.destroy()
    }
}
