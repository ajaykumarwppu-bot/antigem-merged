package com.example.gemini.ui.achiva

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume

/**
 * ACHIVA AGENT BRIDGE (Kotlin side)
 * ---------------------------------
 * The Achiva productivity screen is a persistent WebView. This singleton owns
 * the plumbing between the embedded local MCP bridge server (AndroidLocalBridgeServer's
 * "achiva_mcp" endpoint) and the web page running inside that WebView:
 *
 *   agent → bridge server (/achiva tools/call) → AchivaWebBridge.call()
 *     → webView.evaluateJavascript("window.AchivaAgent.__handle('<json>')")
 *     → JSON string result back → MCP tool result
 *
 * The JS side is assets/achiva-bridge/agent-bridge.js, injected on every page
 * finish (hosted GitHub Pages or bundled assets — works in both modes).
 * It exposes window.AchivaAgent and calls back through the "AchivaBridge"
 * JS interface registered below when it is ready.
 */
object AchivaWebBridge {

    private const val TAG = "AchivaWebBridge"
    private val main = Handler(Looper.getMainLooper())

    @Volatile
    private var webView: WebView? = null

    private val jsReady = AtomicBoolean(false)

    /** Called by AchivaScreen when its WebView is (re)created. Latest wins. */
    fun attach(wv: WebView) {
        webView = wv
        jsReady.set(false)
    }

    fun detach(wv: WebView) {
        if (webView === wv) {
            webView = null
            jsReady.set(false)
        }
    }

    /** JS hooks the injected bridge calls back into. Registered as "AchivaBridge". */
    class JsHooks {
        @JavascriptInterface
        fun notifyReady() {
            jsReady.set(true)
            Log.i(TAG, "Achiva agent bridge ready (window.AchivaAgent installed)")
        }

        @JavascriptInterface
        fun notify(json: String) {
            // Future use (page → app events); for now just log at debug level.
            Log.d(TAG, "Achiva event: ${json.take(300)}")
        }
    }

    val jsHooks = JsHooks()

    fun isReady(): Boolean = webView != null && jsReady.get()

    /** Load assets/achiva-bridge/agent-bridge.js text (cached). Null if missing. */
    @Volatile
    private var cachedScript: String? = null

    fun bridgeScript(wv: WebView): String? {
        cachedScript?.let { return it }
        return try {
            val text = wv.context.assets.open("achiva-bridge/agent-bridge.js").bufferedReader().use { it.readText() }
            cachedScript = text
            text
        } catch (t: Throwable) {
            Log.e(TAG, "agent-bridge.js asset missing", t)
            null
        }
    }

    /** (Re)attach + inject the bridge script into the page. Safe to call repeatedly. */
    fun inject(wv: WebView, script: String) {
        attach(wv)
        main.post {
            try {
                wv.evaluateJavascript(script, null)
            } catch (t: Throwable) {
                Log.w(TAG, "bridge injection failed", t)
            }
        }
    }

    /**
     * Runs one op on the Achiva page and returns the parsed result object.
     * Never throws — failures come back as {"ok":false,"error":...}.
     */
    suspend fun call(cmd: JSONObject): JSONObject {
        val wv = webView ?: return JSONObject()
            .put("ok", false)
            .put("error", "Achiva screen is not initialized. Open the Achiva tab once and let it finish loading, then retry.")
        val js = "window.AchivaAgent && window.AchivaAgent.__handle(" + JSONObject.quote(cmd.toString()) + ")"
        val raw = withTimeoutOrNull(15_000L) {
            suspendCancellableCoroutine<String> { cont ->
                main.post {
                    try {
                        wv.evaluateJavascript(js) { value ->
                            if (cont.isActive) cont.resume(value ?: "null")
                        }
                    } catch (t: Throwable) {
                        Log.w(TAG, "evaluateJavascript failed", t)
                        if (cont.isActive) cont.resume("null")
                    }
                }
            }
        } ?: return JSONObject()
            .put("ok", false)
            .put("error", "Achiva bridge timed out (page busy or still loading). Retry in a moment.")
        return parseResult(raw)
    }

    private fun parseResult(raw: String?): JSONObject {
        if (raw.isNullOrBlank() || raw == "null" || raw == "undefined" || raw == "false") {
            // "false" = expression short-circuited: window.AchivaAgent not installed yet
            return JSONObject()
                .put("ok", false)
                .put("error", "Achiva agent bridge is not active on the page yet (open or reload the Achiva tab once, and make sure it finished loading).")
        }
        return try {
            val trimmed = raw.trim()
            // evaluateJavascript returns the JS value encoded. __handle returns a STRING,
            // so raw is a JSON string literal — unwrap it, then parse the inner JSON.
            if (trimmed.startsWith("\"")) {
                val unwrapped = org.json.JSONTokener(trimmed).nextValue() as? String
                    ?: return bridgeError("unexpected bridge response")
                JSONObject(unwrapped)
            } else {
                JSONObject(trimmed)
            }
        } catch (t: Throwable) {
            bridgeError("unreadable bridge response: ${raw.take(160)}")
        }
    }

    private fun bridgeError(msg: String): JSONObject =
        JSONObject().put("ok", false).put("error", msg)

    /**
     * MCP entry point: dispatch an achiva_* tool call onto the page.
     * Returns an MCP tool result ({content:[{type:"text",text:<json>}]}).
     */
    suspend fun callMcpTool(toolName: String, args: JSONObject): JSONObject {
        val cmd = try {
            JSONObject().put("op", toolName.removePrefix("achiva_")).put("args", args)
        } catch (_: Exception) {
            JSONObject().put("op", toolName.removePrefix("achiva_")).put("args", JSONObject())
        }
        val result = call(cmd)
        val content = JSONArray().put(
            JSONObject().put("type", "text").put("text", result.toString())
        )
        return JSONObject().put("content", content)
    }
}
