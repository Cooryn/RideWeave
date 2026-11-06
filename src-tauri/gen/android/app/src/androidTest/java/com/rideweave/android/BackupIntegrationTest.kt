package com.rideweave.android

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import androidx.core.content.FileProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.intent.Intents
import androidx.test.espresso.intent.matcher.IntentMatchers.hasAction
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class BackupIntegrationTest {
  @Test
  fun savesAndRestoresThroughDocumentResults() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val backup = File.createTempFile("android-backup-test-", ".rideweave-backup", context.cacheDir)
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", backup)
    val selected = Instrumentation.ActivityResult(Activity.RESULT_OK, Intent().setData(uri))
    val id = "backup-test-" + UUID.randomUUID()
    Intents.init()
    try {
      Intents.intending(hasAction(Intent.ACTION_CREATE_DOCUMENT)).respondWith(selected)
      Intents.intending(hasAction(Intent.ACTION_OPEN_DOCUMENT)).respondWith(selected)
      // The instrumentation runner owns the native Tauri event loop's lifetime.
      ActivityScenario.launch(MainActivity::class.java).let { scenario ->
        awaitValue(scenario, "Boolean(document.querySelector('.android-app .page-heading .primary:enabled'))")
        val invoke = "window.__TAURI_INTERNALS__.invoke"
        val db = "'sqlite:rideweave.db'"
        val remove = "$invoke('plugin:sql|execute', {db:$db,query:'DELETE FROM rides WHERE id=?',values:['$id']})"
        try {
          operation(scenario, """
            $invoke('plugin:sql|execute', {db:$db,
              query:'INSERT INTO rides VALUES (?, ?, NULL, 1.2, NULL, ?, ?, ?, ?)',
              values:['$id','已修改名称','[[{"lat":31.2,"lon":121.4,"elevation":null,"time":null}]]',
                '<gpx>原始轨迹</gpx>','native.gpx','2025-10-01T12:00:00.000Z']})
          """.trimIndent())
          assertEquals(true, operation(scenario, "$invoke('export_backup')"))
          assertTrue(backup.length() > 0)
          operation(scenario, remove)
          val restored = operation(scenario, "$invoke('restore_backup')") as JSONObject
          assertEquals(1, restored.getInt("added"))
          val row = operation(scenario, """
            $invoke('plugin:sql|select', {db:$db,query:'SELECT name, raw_gpx, imported_at FROM rides WHERE id=?',values:['$id']})
              .then(rows => rows[0])
          """.trimIndent()) as JSONObject
          assertEquals("已修改名称", row.getString("name"))
          assertEquals("<gpx>原始轨迹</gpx>", row.getString("raw_gpx"))
          assertEquals("2025-10-01T12:00:00.000Z", row.getString("imported_at"))
          val duplicate = operation(scenario, "$invoke('restore_backup')") as JSONObject
          assertEquals(0, duplicate.getInt("added"))
          assertTrue(duplicate.getInt("duplicates") >= 1)
        } finally {
          operation(scenario, remove)
        }
      }
    } finally {
      Intents.release()
      backup.delete()
    }
  }

  private fun operation(scenario: ActivityScenario<MainActivity>, expression: String): Any {
    evaluate(scenario, """
      window.rideWeaveTestResult = null;
      Promise.resolve($expression).then(
        value => { window.rideWeaveTestResult = { value }; },
        error => { window.rideWeaveTestResult = { error: String(error) }; }
      );
    """.trimIndent())
    val result = awaitValue(scenario, "window.rideWeaveTestResult") as JSONObject
    check(!result.has("error")) { result.getString("error") }
    return result.get("value")
  }

  private fun awaitValue(scenario: ActivityScenario<MainActivity>, expression: String): Any {
    val timeout = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
    while (System.nanoTime() < timeout) {
      val value = evaluate(scenario, expression)
      if (value != JSONObject.NULL && value != false) return value
      Thread.sleep(100)
    }
    error("Timed out waiting for RideWeave")
  }

  private fun evaluate(scenario: ActivityScenario<MainActivity>, expression: String): Any {
    val response = CompletableFuture<String>()
    scenario.onActivity { activity ->
      val web = activity.rideWeaveWebView
      if (web == null) response.complete("null")
      else web.evaluateJavascript(expression) { response.complete(it ?: "null") }
    }
    return JSONTokener(response.get(5, TimeUnit.SECONDS)).nextValue()
  }
}
