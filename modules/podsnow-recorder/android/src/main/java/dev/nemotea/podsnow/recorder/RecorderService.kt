package dev.nemotea.podsnow.recorder

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * 録音中にプロセスを維持し、通知を出すフォアグラウンドサービス。
 * 録音処理自体は RecorderEngine が持つ（ARCHITECTURE.md §6、AUDIO_DESIGN.md §3.2）。
 * Android 14+ ではアプリがフォアグラウンドのときにしか開始できない。
 */
class RecorderService : Service() {
  companion object {
    const val CHANNEL_ID = "podsnow_recording"
    const val NOTIFICATION_ID = 0x5052 // "PR"
    private const val ACTION_START = "dev.nemotea.podsnow.recorder.START"
    private const val ACTION_STOP = "dev.nemotea.podsnow.recorder.STOP"

    fun start(context: Context) {
      val i = Intent(context, RecorderService::class.java).setAction(ACTION_START)
      ContextCompat.startForegroundService(context, i)
    }

    fun stop(context: Context) {
      val i = Intent(context, RecorderService::class.java).setAction(ACTION_STOP)
      runCatching { context.startService(i) }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopForegroundCompat()
        stopSelf()
      }
      else -> {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= 30) {
          startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
          startForeground(NOTIFICATION_ID, notification)
        }
      }
    }
    // プロセスが殺された後に勝手に録音を再開しない（復旧はアプリ起動時に行う）
    return START_NOT_STICKY
  }

  private fun buildNotification(): Notification {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) {
      val ch = NotificationChannel(CHANNEL_ID, "録音", NotificationManager.IMPORTANCE_LOW).apply {
        description = "収録中に表示されます"
        setSound(null, null)
      }
      nm.createNotificationChannel(ch)
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val pi = launch?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("podsnow — 収録中")
      .setContentText("タップして戻る")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .apply { if (pi != null) setContentIntent(pi) }
      .build()
  }

  private fun stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= 24) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }
}
