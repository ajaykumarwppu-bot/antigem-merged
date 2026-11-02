package com.example.gemini.ui.achiva

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader

/* ================================================================
   ACHIVA — integrated productivity screen
   ----------------------------------------------------------------
   Achiva ka poora web app AntiGem ke andar ek persistent WebView
   me chalta hai (screen toggle karne par state retain hota hai,
   bilkul IDE/Browser screens ki tarah).

   MODE SWITCH (USE_HOSTED_WEB flag):
     true  → hosted GitHub Pages se load hota hai.
             + hamesha latest web version milega
             + login/Google sign-in pehle se authorized hai
     false → APK ke andar bundled assets se load hota hai
             (assets/achiva/) — offline bhi khulega.
             Google sign-in ke liye ek baar Firebase Console →
             Authentication → Settings → Authorized domains me
             "appassets.androidplatform.net" add karna hoga.
   ================================================================ */

private const val USE_HOSTED_WEB = true
private const val HOSTED_WEB_URL = "https://ajaykumarwppu-bot.github.io/Achiva/"
private const val LOCAL_WEB_URL = "https://appassets.androidplatform.net/assets/achiva/index.html"

private val START_URL: String =
    if (USE_HOSTED_WEB) HOSTED_WEB_URL else LOCAL_WEB_URL

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun AchivaScreen() {
    val context = LocalContext.current
    val screenBg = MaterialTheme.colorScheme.background

    var canGoBack by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(true) }
    var mainFrameError by remember { mutableStateOf(false) }

    val assetLoader = remember {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()
    }

    // Agent bridge: assets/achiva-bridge/agent-bridge.js text (ek hi baar load hota hai)
    val bridgeScript = remember {
        try {
            context.assets.open("achiva-bridge/agent-bridge.js").bufferedReader().use { it.readText() }
        } catch (_: Exception) {
            null
        }
    }

    val webView = remember {
        WebView(context).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            settings.javaScriptEnabled = true
            // Achiva ka data + login session localStorage me rehta hai
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.loadWithOverviewMode = true
            settings.useWideViewPort = true
            // Firebase/Google sign-in ke liye cookies (3rd-party consent pages)
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
            // Achiva Agent Bridge: agent (MCP achiva_mcp) isi WebView ko control karta hai.
            // Hooks page ki taraf se sirf notifyReady/notify call karte hain — commands
            // sirf Kotlin → JS direction mein evaluateJavascript se jaate hain.
            addJavascriptInterface(AchivaWebBridge.jsHooks, "AchivaBridge")
            AchivaWebBridge.attach(this)

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? {
                    // Local-assets mode: appassets.androidplatform.net ke requests
                    // APK ke andar bundled files se serve hote hain.
                    return try {
                        assetLoader.shouldInterceptRequest(request.url)
                    } catch (_: Exception) {
                        null
                    }
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest
                ): Boolean {
                    // Sab navigations WebView ke andar hi (Google consent
                    // redirect-flow isi liye zaroori hai)
                    return false
                }

                override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                    isLoading = true
                }

                override fun onPageFinished(view: WebView, url: String?) {
                    isLoading = false
                    // Har (re)load par agent bridge dobara inject karo — hosted page
                    // navigate/reload par naya document bana leta hai.
                    bridgeScript?.let { AchivaWebBridge.inject(view, it) }
                }

                override fun doUpdateVisitedHistory(
                    view: WebView,
                    url: String?,
                    isReload: Boolean
                ) {
                    canGoBack = view.canGoBack()
                }

                override fun onReceivedError(
                    view: WebView,
                    request: WebResourceRequest,
                    error: WebResourceError
                ) {
                    if (request.isForMainFrame) mainFrameError = true
                }
            }
            loadUrl(START_URL)
        }
    }

    // Andar ki web history ho to pehle web back, warna AntiGem ke
    // MainActivity ka BackHandler (CHAT par wapas) chalta hai.
    BackHandler(enabled = canGoBack) {
        webView.goBack()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(screenBg)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            AndroidView(
                factory = { webView },
                modifier = Modifier.fillMaxSize()
            )

            if (isLoading && !mainFrameError) {
                LinearProgressIndicator(
                    modifier = Modifier
                        .fillMaxWidth()
                        .align(Alignment.TopCenter)
                )
            }

            if (mainFrameError) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(screenBg),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                        modifier = Modifier.padding(24.dp)
                    ) {
                        Text(
                            text = "Achiva load nahi ho paya",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = "Internet connection check karein, phir dobara try karein.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center
                        )
                        Spacer(modifier = Modifier.height(20.dp))
                        Button(onClick = {
                            mainFrameError = false
                            isLoading = true
                            webView.reload()
                        }) {
                            Text("Dobara try karein")
                        }
                    }
                }
            }
        }
    }
}
