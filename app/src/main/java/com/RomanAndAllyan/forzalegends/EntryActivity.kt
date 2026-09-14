package com.RomanAndAllyan.forzalegends

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Portrait-friendly launcher trampoline.
 *
 * Pixel Launcher often drops taps on a landscape-only MAIN/LAUNCHER
 * activity when the home screen is portrait. This entry activity has no
 * orientation lock so the home-screen icon always starts the game.
 */
class EntryActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        )
        finish()
        @Suppress("DEPRECATION")
        overridePendingTransition(0, 0)
    }
}
