package com.RomanAndAllyan.forzalegends

import android.app.Activity
import android.content.Context
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.appopen.AppOpenAd
import java.util.Date

class AppOpenAdManager(private val context: Context) {

    private var appOpenAd: AppOpenAd? = null
    private var isLoadingAd = false
    private var isShowingAd = false
    private var loadTime: Long = 0

    companion object {
        // Unit ID comes from AdsConfig — flip USE_TEST_ADS for Play Store.
    }

    fun preload() {
        loadAd()
    }

    private fun loadAd() {
        if (isLoadingAd || isAdAvailable()) return

        isLoadingAd = true

        val request = AdRequest.Builder().build()

        AppOpenAd.load(
            context,
            AdsConfig.APP_OPEN,
            request,
            object : AppOpenAd.AppOpenAdLoadCallback() {

                override fun onAdLoaded(ad: AppOpenAd) {
                    appOpenAd = ad
                    isLoadingAd = false
                    loadTime = Date().time
                }

                override fun onAdFailedToLoad(error: LoadAdError) {
                    isLoadingAd = false
                }
            }
        )
    }

    private fun isAdAvailable(): Boolean {
        return appOpenAd != null &&
                Date().time - loadTime < 4 * 60 * 60 * 1000L
    }

    fun showAdIfAvailable(activity: Activity, onDismiss: (() -> Unit)? = null) {
        if (isShowingAd) {
            onDismiss?.invoke()
            return
        }

        if (!isAdAvailable()) {
            loadAd()
            onDismiss?.invoke()
            return
        }

        val ad = appOpenAd ?: run {
            onDismiss?.invoke()
            return
        }

        isShowingAd = true
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() {
                appOpenAd = null
                isShowingAd = false
                loadAd()
                onDismiss?.invoke()
            }

            override fun onAdFailedToShowFullScreenContent(
                adError: com.google.android.gms.ads.AdError
            ) {
                appOpenAd = null
                isShowingAd = false
                loadAd()
                onDismiss?.invoke()
            }
        }
        ad.show(activity)
    }
}
