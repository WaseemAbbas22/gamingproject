package com.RomanAndAllyan.forzalegends

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.google.android.gms.ads.MobileAds
import java.util.concurrent.Executors

class MyApplication : Application(),
    Application.ActivityLifecycleCallbacks,
    DefaultLifecycleObserver {

    private lateinit var appOpenAdManager: AppOpenAdManager
    private var currentActivity: Activity? = null
    private val processStartMs = SystemClock.elapsedRealtime()
    private var lastBackgroundMs = 0L
    private var finishedFirstStart = false

    override fun onCreate() {
        super<Application>.onCreate()

        // AdMob init is expensive — never block the first UI frame with it.
        Executors.newSingleThreadExecutor().execute {
            MobileAds.initialize(this) {}
        }

        registerActivityLifecycleCallbacks(this)

        ProcessLifecycleOwner.get()
            .lifecycle
            .addObserver(this)

        appOpenAdManager = AppOpenAdManager(this)
        Handler(Looper.getMainLooper()).postDelayed({
            appOpenAdManager.preload()
        }, 8_000L)
    }

    override fun onActivityStarted(activity: Activity) {
        currentActivity = activity
    }

    override fun onActivityResumed(activity: Activity) {
        currentActivity = activity
    }

    override fun onActivityCreated(
        activity: Activity,
        savedInstanceState: Bundle?
    ) {}

    override fun onActivityPaused(activity: Activity) {}

    override fun onActivityStopped(activity: Activity) {}

    override fun onActivitySaveInstanceState(
        activity: Activity,
        outState: Bundle
    ) {}

    override fun onActivityDestroyed(activity: Activity) {
        if (currentActivity == activity) {
            currentActivity = null
        }
    }

    override fun onStop(owner: LifecycleOwner) {
        lastBackgroundMs = SystemClock.elapsedRealtime()
    }

    override fun onStart(owner: LifecycleOwner) {
        // Never intercept the launcher icon / first open with a full-screen ad.
        // App-open ads only appear after the player has actually used the game
        // and then left it in the background for a while.
        if (!finishedFirstStart) {
            finishedFirstStart = true
            return
        }
        if (!::appOpenAdManager.isInitialized) return
        if (SystemClock.elapsedRealtime() - processStartMs < 45_000L) return
        if (lastBackgroundMs == 0L) return
        if (SystemClock.elapsedRealtime() - lastBackgroundMs < 30_000L) return

        val activity = currentActivity ?: return
        if (activity !is MainActivity || activity.isFinishing) return
        if (!activity.isGameInteractive()) return

        activity.pauseGameForAds()
        appOpenAdManager.showAdIfAvailable(activity) {
            if (!activity.isFinishing) {
                activity.resumeGameAfterAds()
            }
        }
    }
}
