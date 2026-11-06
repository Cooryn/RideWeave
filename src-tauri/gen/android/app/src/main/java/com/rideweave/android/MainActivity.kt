package com.rideweave.android

import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  var rideWeaveWebView: WebView? = null
  val rideWeaveBack = object : OnBackPressedCallback(false) {
    override fun handleOnBackPressed() {
      dispatch("rideweave-back")
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    onBackPressedDispatcher.addCallback(this, rideWeaveBack)
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val safe = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(safe.left, safe.top, safe.right, maxOf(safe.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(content)
    applyRideWeaveTheme(true)
  }

  fun dispatch(event: String) {
    runOnUiThread {
      rideWeaveWebView?.evaluateJavascript("window.dispatchEvent(new Event('$event'))", null)
    }
  }

  fun applyRideWeaveTheme(dark: Boolean) {
    val color = Color.parseColor(if (dark) "#080b0c" else "#f2f3f5")
    findViewById<View>(android.R.id.content).setBackgroundColor(color)
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = !dark
      isAppearanceLightNavigationBars = !dark
    }
  }
}
