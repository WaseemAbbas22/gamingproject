package com.RomanAndAllyan.forzalegends

/**
 * AdMob unit IDs — change here only before Play Store upload.
 *
 * While developing:
 *   USE_TEST_ADS = true  → Google sample test units (safe, no policy risk)
 *
 * Before uploading to Play Store:
 *   1. Paste your real AdMob unit IDs into LIVE_* below
 *   2. Set USE_TEST_ADS = false
 *
 * App ID in AndroidManifest (ca-app-pub-…~…) stays as your live app ID.
 */
object AdsConfig {
    /** Flip to false for production / Play Store builds. */
    const val USE_TEST_ADS = true

    // Google official test units (do not change)
    private const val TEST_BANNER = "ca-app-pub-3940256099942544/6300978111"
    private const val TEST_INTERSTITIAL = "ca-app-pub-3940256099942544/1033173712"
    private const val TEST_REWARDED = "ca-app-pub-3940256099942544/5224354917"
    private const val TEST_APP_OPEN = "ca-app-pub-3940256099942544/9257395921"

    // === Paste your real AdMob unit IDs here ===
    private const val LIVE_BANNER = "ca-app-pub-xxxxxxxxxxxxxxxx/xxxxxxxxxx"
    private const val LIVE_INTERSTITIAL = "ca-app-pub-xxxxxxxxxxxxxxxx/xxxxxxxxxx"
    private const val LIVE_REWARDED = "ca-app-pub-xxxxxxxxxxxxxxxx/xxxxxxxxxx"
    private const val LIVE_APP_OPEN = "ca-app-pub-xxxxxxxxxxxxxxxx/xxxxxxxxxx"

    val BANNER: String get() = if (USE_TEST_ADS) TEST_BANNER else LIVE_BANNER
    val INTERSTITIAL: String get() = if (USE_TEST_ADS) TEST_INTERSTITIAL else LIVE_INTERSTITIAL
    val REWARDED: String get() = if (USE_TEST_ADS) TEST_REWARDED else LIVE_REWARDED
    val APP_OPEN: String get() = if (USE_TEST_ADS) TEST_APP_OPEN else LIVE_APP_OPEN
}
