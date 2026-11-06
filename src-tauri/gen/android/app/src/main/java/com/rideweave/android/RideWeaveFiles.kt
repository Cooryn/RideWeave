package com.rideweave.android

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

@TauriPlugin
class RideWeaveFiles(private val activity: Activity) : Plugin(activity) {
  @InvokeArg
  class BackupArgs {
    lateinit var path: String
    var export: Boolean = false
  }

  @InvokeArg
  class TokenArgs {
    lateinit var token: String
  }

  @InvokeArg
  class ToggleArgs {
    var enabled: Boolean = false
  }

  private val main get() = activity as MainActivity
  private val resolver get() = activity.contentResolver
  private val io = Executors.newSingleThreadExecutor()
  private val pending = linkedSetOf<Uri>()
  private val granted = mutableMapOf<String, Uri>()

  override fun load(webView: WebView) {
    main.rideWeaveWebView = webView
    if (receive(activity.intent)) activity.setIntent(Intent(Intent.ACTION_MAIN))
  }

  override fun onNewIntent(intent: Intent) {
    if (receive(intent)) main.dispatch("rideweave-share")
  }

  @Suppress("DEPRECATION")
  private fun receive(intent: Intent?): Boolean {
    if (intent == null || intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION == 0) return false
    val uris = when (intent.action) {
      Intent.ACTION_VIEW -> listOfNotNull(intent.data)
      Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
      Intent.ACTION_SEND_MULTIPLE ->
        intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
      else -> return false
    }
    val files = (uris + (intent.clipData?.let { clip ->
      (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
    } ?: emptyList())).filter {
      it.scheme == "content" && it.authority != activity.packageName + ".fileprovider"
    }
    synchronized(pending) { pending.addAll(files) }
    return files.isNotEmpty()
  }

  @Command
  fun takeSharedGpx(invoke: Invoke) {
    val files = synchronized(pending) { pending.toList().also { pending.clear() } }
    io.execute {
      granted.clear()
      val entries = JSONArray()
      files.forEach { uri ->
        val token = UUID.randomUUID().toString()
        granted[token] = uri
        val entry = JSObject().apply {
          put("token", token)
          put("name", uri.lastPathSegment?.substringAfterLast('/') ?: "分享文件")
        }
        runCatching {
          resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
            ?.use { cursor ->
              if (cursor.moveToFirst()) {
                val name = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val size = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (name >= 0 && !cursor.isNull(name)) entry.put("name", cursor.getString(name))
                if (size >= 0 && !cursor.isNull(size)) {
                  cursor.getLong(size).takeIf { it >= 0 }?.let { entry.put("size", it) }
                }
              }
            }
        }
        entries.put(entry)
      }
      invoke.resolve(JSObject().put("files", entries))
    }
  }

  @Command
  fun openSharedGpx(invoke: Invoke) {
    val args = invoke.parseArgs(TokenArgs::class.java)
    io.execute {
      try {
        val uri = granted.remove(args.token) ?: error("文件分享授权已失效")
        val fd = resolver.openFileDescriptor(uri, "r")?.use { it.detachFd() }
          ?: error("无法读取分享文件")
        invoke.resolve(JSObject().put("fd", fd))
      } catch (_: Exception) {
        invoke.reject("无法读取分享的 GPX，请重新分享文件。")
      }
    }
  }

  @Command
  fun copyBackup(invoke: Invoke) {
    val args = invoke.parseArgs(BackupArgs::class.java)
    val intent = Intent(if (args.export) Intent.ACTION_CREATE_DOCUMENT else Intent.ACTION_OPEN_DOCUMENT)
      .addCategory(Intent.CATEGORY_OPENABLE)
      .setType(if (args.export) "application/octet-stream" else "*/*")
    if (args.export) intent.putExtra(Intent.EXTRA_TITLE, "RideWeave.rideweave-backup")
    try {
      startActivityForResult(invoke, intent, "backupResult")
    } catch (_: Exception) {
      invoke.reject("无法打开系统文件选择器。")
    }
  }

  @ActivityCallback
  fun backupResult(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null) {
      invoke.resolve(JSObject().put("selected", false))
      return
    }
    val args = invoke.parseArgs(BackupArgs::class.java)
    io.execute {
      try {
        val file = File(args.path)
        if (args.export) {
          val output = resolver.openOutputStream(uri, "wt") ?: error("无法打开备份位置")
          output.use { target -> file.inputStream().use { it.copyTo(target) } }
        } else {
          val input = resolver.openInputStream(uri) ?: error("无法读取备份")
          input.use { source -> file.outputStream().use { source.copyTo(it) } }
        }
        invoke.resolve(JSObject().put("selected", true))
      } catch (_: Exception) {
        if (args.export) runCatching { DocumentsContract.deleteDocument(resolver, uri) }
        invoke.reject(if (args.export) "无法写入备份，请检查保存位置和可用空间。" else "无法读取备份，请检查文件和可用空间。")
      }
    }
  }

  @Command
  fun setTheme(invoke: Invoke) {
    val args = invoke.parseArgs(ToggleArgs::class.java)
    activity.runOnUiThread {
      main.applyRideWeaveTheme(args.enabled)
      invoke.resolve()
    }
  }

  @Command
  fun setBackEnabled(invoke: Invoke) {
    val args = invoke.parseArgs(ToggleArgs::class.java)
    activity.runOnUiThread {
      main.rideWeaveBack.isEnabled = args.enabled
      invoke.resolve()
    }
  }
}
