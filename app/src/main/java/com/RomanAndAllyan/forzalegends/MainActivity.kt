package com.RomanAndAllyan.forzalegends

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout

import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback

import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.gms.ads.interstitial.InterstitialAd
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var adView: AdView

    private var rewardedAd: RewardedAd? = null
    private var interstitialAd: InterstitialAd? = null
    private val INTERSTITIAL_AD_UNIT_ID =
        "ca-app-pub-3940256099942544/1033173712"
    // APNI REWARDED AD UNIT ID YAHAN LAGAO
    private val REWARDED_AD_UNIT_ID =
        "ca-app-pub-3940256099942544/5224354917"


    // ---------------------------------------------------------
    // LOAD REWARDED AD
    // ---------------------------------------------------------

    private fun loadRewardedAd() {

        val adRequest = AdRequest.Builder().build()

        RewardedAd.load(
            this@MainActivity,
            REWARDED_AD_UNIT_ID,
            adRequest,
            object : RewardedAdLoadCallback() {

                override fun onAdLoaded(ad: RewardedAd) {
                    rewardedAd = ad
                }

                override fun onAdFailedToLoad(adError: LoadAdError) {
                    rewardedAd = null
                }
            }
        )
    }
    private fun loadInterstitialAd() {

        val adRequest = AdRequest.Builder().build()

        InterstitialAd.load(
            this@MainActivity,
            INTERSTITIAL_AD_UNIT_ID,
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

    // ---------------------------------------------------------
    // JAVASCRIPT BRIDGE
    // ---------------------------------------------------------

    @JavascriptInterface
    fun showRewardedAd() {

        runOnUiThread {

            val ad = rewardedAd

            if (ad != null) {

                ad.show(
                    this@MainActivity
                ) {
                    // User earned reward
                    webView.evaluateJavascript(
                        "window.onRewardedAdCompleted()",
                        null
                    )
                }

                // Purana ad hatao
                rewardedAd = null

                // Agla ad load karo
                loadRewardedAd()

            } else {

                // Ad ready nahi tha
                loadRewardedAd()
            }
        }
    }
    @JavascriptInterface
    fun showInterstitialAd() {

        runOnUiThread {

            val ad = interstitialAd

            if (ad != null) {

                ad.show(this@MainActivity)

                interstitialAd = null

                loadInterstitialAd()

            } else {

                loadInterstitialAd()
            }
        }
    }

    // ---------------------------------------------------------
    // ON CREATE
    // ---------------------------------------------------------

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Fullscreen
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


        // Main container
        val container = FrameLayout(this)


        // -----------------------------------------------------
        // WEBVIEW
        // -----------------------------------------------------

        webView = WebView(this)

        val settings: WebSettings = webView.settings

        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode =
            WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

        webView.setLayerType(
            View.LAYER_TYPE_HARDWARE,
            null
        )

        webView.webViewClient = WebViewClient()
        webView.webChromeClient = WebChromeClient()


        // HTML se Android ko connect karta hai
        webView.addJavascriptInterface(
            this@MainActivity,
            "AndroidBridge"
        )


        // -----------------------------------------------------
        // ADMOB INITIALIZE
        // -----------------------------------------------------

        MobileAds.initialize(this@MainActivity) {
            loadRewardedAd()
            loadInterstitialAd()
        }

        // -----------------------------------------------------
        // GAME LOAD
        // -----------------------------------------------------

        webView.loadUrl(
            "file:///android_asset/index.html"
        )


        // -----------------------------------------------------
        // WEBVIEW LAYOUT
        // -----------------------------------------------------

        val webViewParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        )

        container.addView(
            webView,
            webViewParams
        )


        // -----------------------------------------------------
        // BANNER AD
        // -----------------------------------------------------

        adView = AdView(this)

        adView.setAdSize(
            AdSize.BANNER
        )

        // GOOGLE TEST BANNER ID
        adView.adUnitId =
            "ca-app-pub-3940256099942544/6300978111"


        val adParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        )

        adParams.gravity =
            android.view.Gravity.BOTTOM or android.view.Gravity.START

        adParams.leftMargin = 35
        adParams.bottomMargin = 10

// Banner ko thoda chhota karo
        adView.scaleX = 0.90f
        adView.scaleY = 0.90f

        container.addView(adView, adParams)


        // Banner load
        val adRequest = AdRequest.Builder().build()

        adView.loadAd(adRequest)


        // Screen set
        setContentView(container)


        // -----------------------------------------------------
        // BACK BUTTON
        // -----------------------------------------------------

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


    // ---------------------------------------------------------
    // DESTROY
    // ---------------------------------------------------------

    override fun onDestroy() {

        adView.destroy()
        webView.destroy()

        super.onDestroy()
    }
}