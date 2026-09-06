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
        // Google TEST App Open Ad ID
        private const val AD_UNIT_ID =
            "ca-app-pub-3940256099942544/9257395921"
    }

    init {
        loadAd()
    }

    private fun loadAd() {
        if (isLoadingAd || isAdAvailable()) return

        isLoadingAd = true

        val request = AdRequest.Builder().build()

        AppOpenAd.load(
            context,
            AD_UNIT_ID,
            request,
            object : AppOpenAd.AppOpenAdLoadCallback() {

                override fun onAdLoaded(ad: AppOpenAd) {
                    appOpenAd = ad
                    isLoadingAd = false
                    loadTime = Date().time
                    setFullScreenContentCallback()
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

    fun showAdIfAvailable(activity: Activity) {

        if (isShowingAd) return

        if (!isAdAvailable()) {
            loadAd()
            return
        }

        isShowingAd = true
        appOpenAd?.show(activity)
    }

    private fun setFullScreenContentCallback() {

        appOpenAd?.fullScreenContentCallback =
            object : FullScreenContentCallback() {

                override fun onAdDismissedFullScreenContent() {
                    appOpenAd = null
                    isShowingAd = false
                    loadAd()
                }

                override fun onAdFailedToShowFullScreenContent(
                    adError: com.google.android.gms.ads.AdError
                ) {
                    appOpenAd = null
                    isShowingAd = false
                    loadAd()
                }
            }
    }
}