package com.RomanAndAllyan.forzalegends

import android.app.Activity
import android.app.Application
import android.os.Bundle
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.google.android.gms.ads.MobileAds

class MyApplication : Application(),
    Application.ActivityLifecycleCallbacks,
    DefaultLifecycleObserver {

    private lateinit var appOpenAdManager: AppOpenAdManager
    private var currentActivity: Activity? = null

    override fun onCreate() {
        super<Application>.onCreate()

        MobileAds.initialize(this)

        registerActivityLifecycleCallbacks(this)

        ProcessLifecycleOwner.get()
            .lifecycle
            .addObserver(this)

        appOpenAdManager = AppOpenAdManager(this)
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

    override fun onStart(owner: LifecycleOwner) {
        if (::appOpenAdManager.isInitialized) {
            currentActivity?.let { activity ->
                appOpenAdManager.showAdIfAvailable(activity)
            }
        }
    }
}