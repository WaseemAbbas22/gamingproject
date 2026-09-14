package com.RomanAndAllyan.forzalegends

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout

import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback

import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdListener
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.interstitial.InterstitialAd
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var adView: AdView

    private var rewardedAd: RewardedAd? = null
    private var interstitialAd: InterstitialAd? = null
    private var gamePausedForAd = false
    private var bannerLoaded = false
    private var menuBannerWanted = false
    private var pendingRewardedShow = false
    private var gameInteractive = false

    fun isGameInteractive(): Boolean = gameInteractive && !isFinishing && !isDestroyed

    private val mainHandler = Handler(Looper.getMainLooper())

    private var bannerMode = "hidden"

    private var adContainer: FrameLayout? = null

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    private fun applyBannerPlacement(mode: String) {
        if (!::adView.isInitialized) return
        bannerMode = mode
        menuBannerWanted = mode == "menu" || mode == "race"
        if (mode == "hidden") {
            adView.visibility = View.GONE
            return
        }
        val lp = adView.layoutParams as FrameLayout.LayoutParams
        lp.gravity = android.view.Gravity.BOTTOM or android.view.Gravity.CENTER_HORIZONTAL
        if (mode == "race") {
            // Small banner at bottom-center edge during race
            adView.scaleX = 0.52f
            adView.scaleY = 0.52f
            lp.bottomMargin = dp(6)
        } else {
            // Menu/route: small banner in dock center gap
            adView.scaleX = 0.58f
            adView.scaleY = 0.58f
            lp.bottomMargin = dp(14)
        }
        adView.layoutParams = lp
        adView.elevation = 48f
        adView.visibility = View.VISIBLE
        adContainer?.bringChildToFront(adView)
        adView.bringToFront()
        loadBannerIfNeeded()
        // Keep ad above WebView after layout settles
        mainHandler.post {
            if (!isFinishing && menuBannerWanted) {
                adContainer?.bringChildToFront(adView)
                adView.visibility = View.VISIBLE
            }
        }
    }

    private fun loadRewardedAd() {
        if (isFinishing) return
        val adRequest = AdRequest.Builder().build()
        RewardedAd.load(
            this@MainActivity,
            AdsConfig.REWARDED,
            adRequest,
            object : RewardedAdLoadCallback() {
                override fun onAdLoaded(ad: RewardedAd) {
                    rewardedAd = ad
                    if (pendingRewardedShow) {
                        pendingRewardedShow = false
                        showRewardedAd()
                    }
                }

                override fun onAdFailedToLoad(adError: LoadAdError) {
                    rewardedAd = null
                    if (pendingRewardedShow) {
                        pendingRewardedShow = false
                        if (::webView.isInitialized) {
                            val msg = adError.message.replace("'", "\\'")
                            webView.evaluateJavascript(
                                "window.onRewardedAdFailed&&window.onRewardedAdFailed('Ad failed: $msg')",
                                null
                            )
                        }
                    }
                }
            }
        )
    }

    private fun loadInterstitialAd() {
        if (isFinishing) return
        val adRequest = AdRequest.Builder().build()
        InterstitialAd.load(
            this@MainActivity,
            AdsConfig.INTERSTITIAL,
            adRequest,
            object : InterstitialAdLoadCallback() {
                override fun onAdLoaded(ad: InterstitialAd) {
                    interstitialAd = ad
                }

                override fun onAdFailedToLoad(adError: LoadAdError) {
                    interstitialAd = null
                }
            }
        )
    }

    private fun loadBannerIfNeeded() {
        if (bannerLoaded || isFinishing || !::adView.isInitialized) return
        bannerLoaded = true
        adView.loadAd(AdRequest.Builder().build())
    }

    fun pauseGameForAds() {
        if (gamePausedForAd) return
        gamePausedForAd = true
        if (::webView.isInitialized) {
            webView.evaluateJavascript("window.__gamePaused=true", null)
            webView.onPause()
            webView.pauseTimers()
        }
        if (::adView.isInitialized) {
            adView.pause()
        }
    }

    fun resumeGameAfterAds() {
        if (!gamePausedForAd) return
        gamePausedForAd = false
        if (::webView.isInitialized) {
            webView.resumeTimers()
            webView.onResume()
            webView.evaluateJavascript("window.__gamePaused=false", null)
        }
        if (::adView.isInitialized) {
            adView.resume()
        }
    }

    @JavascriptInterface
    fun showRewardedAd() {
        runOnUiThread {
            val ad = rewardedAd
            if (ad == null) {
                pendingRewardedShow = true
                loadRewardedAd()
                return@runOnUiThread
            }

            pendingRewardedShow = false
            pauseGameForAds()
            ad.fullScreenContentCallback = object : FullScreenContentCallback() {
                override fun onAdDismissedFullScreenContent() {
                    resumeGameAfterAds()
                    webView.evaluateJavascript(
                        "window.onRewardedAdClosed&&window.onRewardedAdClosed()",
                        null
                    )
                }

                override fun onAdFailedToShowFullScreenContent(adError: AdError) {
                    resumeGameAfterAds()
                    val msg = adError.message.replace("'", "\\'")
                    webView.evaluateJavascript(
                        "window.onRewardedAdFailed&&window.onRewardedAdFailed('Ad failed to show: $msg')",
                        null
                    )
                }
            }
            ad.show(this@MainActivity) {
                webView.evaluateJavascript("window.onRewardedAdCompleted()", null)
            }
            rewardedAd = null
            mainHandler.postDelayed({ loadRewardedAd() }, 1_500L)
        }
    }

    @JavascriptInterface
    fun setMenuBannerVisible(show: Boolean) {
        setBannerPlacement(if (show) "menu" else "hidden")
    }

    @JavascriptInterface
    fun setBannerPlacement(mode: String) {
        runOnUiThread {
            applyBannerPlacement(mode)
        }
    }

    @JavascriptInterface
    fun showInterstitialAd() {
        runOnUiThread {
            val ad = interstitialAd
            if (ad == null) {
                loadInterstitialAd()
                return@runOnUiThread
            }

            pauseGameForAds()
            ad.fullScreenContentCallback = object : FullScreenContentCallback() {
                override fun onAdDismissedFullScreenContent() {
                    resumeGameAfterAds()
                }

                override fun onAdFailedToShowFullScreenContent(adError: AdError) {
                    resumeGameAfterAds()
                }
            }
            ad.show(this@MainActivity)
            interstitialAd = null
            mainHandler.postDelayed({ loadInterstitialAd() }, 1_500L)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        )

        window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        or View.SYSTEM_UI_FLAG_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                )

        val container = FrameLayout(this)
        adContainer = container

        webView = WebView(this)
        webView.setBackgroundColor(0xFF07090C.toInt())
        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.loadsImagesAutomatically = true
        settings.blockNetworkImage = false
        @Suppress("DEPRECATION")
        settings.allowFileAccessFromFileURLs = true
        @Suppress("DEPRECATION")
        settings.allowUniversalAccessFromFileURLs = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.setRendererPriorityPolicy(
                WebView.RENDERER_PRIORITY_IMPORTANT,
                true
            )
        }

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        webView.elevation = 0f
        webView.isClickable = true
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                android.util.Log.d(
                    "ForzaWeb",
                    "${consoleMessage.messageLevel()} ${consoleMessage.sourceId()}:${consoleMessage.lineNumber()} ${consoleMessage.message()}"
                )
                return true
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                val url = request.url?.toString() ?: return super.shouldInterceptRequest(view, request)
                if (!url.startsWith("file:///android_asset/")) {
                    return super.shouldInterceptRequest(view, request)
                }
                val path = url.removePrefix("file:///android_asset/").substringBefore('?')
                return try {
                    val mime = when {
                        path.endsWith(".js") -> "text/javascript"
                        path.endsWith(".mjs") -> "text/javascript"
                        path.endsWith(".css") -> "text/css"
                        path.endsWith(".html") -> "text/html"
                        path.endsWith(".json") -> "application/json"
                        path.endsWith(".wasm") -> "application/wasm"
                        path.endsWith(".png") -> "image/png"
                        path.endsWith(".jpg") || path.endsWith(".jpeg") -> "image/jpeg"
                        path.endsWith(".webp") -> "image/webp"
                        path.endsWith(".svg") -> "image/svg+xml"
                        else -> "application/octet-stream"
                    }
                    WebResourceResponse(mime, "utf-8", assets.open(path))
                } catch (_: Exception) {
                    super.shouldInterceptRequest(view, request)
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                mainHandler.postDelayed({ gameInteractive = true }, 800L)
                // Ads wait until the 3D page has painted so they cannot ANR startup.
                mainHandler.postDelayed({
                    loadRewardedAd()
                    loadInterstitialAd()
                    loadBannerIfNeeded()
                }, 2_000L)
            }
        }

        webView.addJavascriptInterface(
            this@MainActivity,
            "AndroidBridge"
        )

        webView.loadUrl("file:///android_asset/index.html")

        container.addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        adView = AdView(this)
        adView.setAdSize(AdSize.BANNER)
        adView.adUnitId = AdsConfig.BANNER
        adView.visibility = View.GONE
        adView.adListener = object : AdListener() {
            override fun onAdLoaded() {
                if (!isFinishing && menuBannerWanted) adView.visibility = View.VISIBLE
            }
        }

        val adParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        )
        adParams.gravity = android.view.Gravity.BOTTOM or android.view.Gravity.CENTER_HORIZONTAL
        adParams.bottomMargin = dp(14)
        container.addView(adView, adParams)

        setContentView(container)
        webView.requestFocus()

        onBackPressedDispatcher.addCallback(
            this@MainActivity,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        finish()
                    }
                }
            }
        )
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        resumeGameAfterAds()
        if (::webView.isInitialized) {
            webView.requestFocus()
        }
    }

    override fun onPause() {
        pauseGameForAds()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        resumeGameAfterAds()
    }

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        if (::adView.isInitialized) {
            adView.destroy()
        }
        if (::webView.isInitialized) {
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.destroy()
        }
        super.onDestroy()
    }
}
