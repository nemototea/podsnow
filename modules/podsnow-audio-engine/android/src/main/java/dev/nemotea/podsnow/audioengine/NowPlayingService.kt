package dev.nemotea.podsnow.audioengine

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.Icon
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.IBinder
import android.os.SystemClock
import androidx.core.content.ContextCompat

/**
 * ロック画面・通知の再生表示と操作（AUDIO_DESIGN.md §10.5）。
 * ファイル再生（expo-audio）とタイムライン再生（TimelinePlayer）の両方をここで出す。
 *
 * - `mediaPlayback` の前面サービスでプロセスを保つ（Android は前面サービスが無いと約 3 分で止まる）。
 *   表示している間は一時停止中も前面に保つ。一時停止で外すと、ロック画面から再開するときに
 *   バックグラウンドから前面サービスを始め直すことになり、Android 12 以降の制限で失敗するおそれがある【仮説】。
 * - 何を出すかは JS の PlaybackService が決める。操作は鳴らす側を触らず、`onCommand` で JS に送る。
 * - 文言は JS（UI 層）から受け取る（ネイティブは文言を持たない。録音の通知と同じ）。
 */
class NowPlayingService : Service() {
  data class Labels(
    val play: String,
    val pause: String,
    val rewind: String,
    val forward: String,
    val stop: String,
    val channelName: String,
    val channelDescription: String,
  )

  data class Info(
    val title: String,
    val artist: String,
    val artworkPath: String?,
    val durationSec: Double,
    val positionSec: Double,
    val playing: Boolean,
    val labels: Labels,
  )

  companion object {
    private const val CHANNEL_ID = "podsnow_playback"
    private const val NOTIFICATION_ID = 0x504C // "PL"
    private const val ACTION_UPDATE = "dev.nemotea.podsnow.audioengine.NOW_PLAYING_UPDATE"
    private const val ACTION_COMMAND = "dev.nemotea.podsnow.audioengine.NOW_PLAYING_COMMAND"
    private const val EXTRA_COMMAND = "command"
    private const val CUSTOM_REWIND = "rewind15"
    private const val CUSTOM_FORWARD = "forward30"

    @Volatile private var info: Info? = null
    private var instance: NowPlayingService? = null

    /** JS へ送る操作（command, positionSec）。モジュールが設定する。 */
    @Volatile var onCommand: ((String, Double?) -> Unit)? = null

    /** 表示を更新する。最初の 1 回は前面サービスを始める（利用者が画面で再生を押したとき＝前面にいるとき）。 */
    fun update(context: Context, next: Info) {
      info = next
      instance?.let {
        it.apply(next)
        return
      }
      val i = Intent(context, NowPlayingService::class.java).setAction(ACTION_UPDATE)
      ContextCompat.startForegroundService(context, i)
    }

    fun clear() {
      info = null
      instance?.shutdown()
    }
  }

  private var session: MediaSession? = null
  private var foreground = false
  private var artPath: String? = null
  private var art: Bitmap? = null

  private val callback = object : MediaSession.Callback() {
    // ヘッドホン・Bluetooth の再生ボタンも既定の onMediaButtonEvent からここへ来る
    override fun onPlay() = send("play")
    override fun onPause() = send("pause")
    override fun onStop() = send("stop")
    override fun onSeekTo(pos: Long) = send("seek", pos / 1000.0)
    override fun onCustomAction(action: String, extras: android.os.Bundle?) {
      when (action) {
        CUSTOM_REWIND -> send("skipBackward")
        CUSTOM_FORWARD -> send("skipForward")
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    instance = this
    session = MediaSession(this, "PodsNow").apply {
      setCallback(callback)
      isActive = true
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_COMMAND) {
      intent.getStringExtra(EXTRA_COMMAND)?.let { send(it) }
      return START_NOT_STICKY
    }
    val current = info
    if (current == null) {
      // startForegroundService のあとは必ず前面にする必要がある。消す指示が先に来ていたら、出してすぐ止める
      startInForeground(Notification.Builder(this, ensureChannel(null)).setSmallIcon(android.R.drawable.ic_media_play).build())
      shutdown()
      return START_NOT_STICKY
    }
    apply(current)
    // プロセスが殺されたあとに勝手に再生を再開しない
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    session?.release()
    session = null
    super.onDestroy()
  }

  private fun send(command: String, positionSec: Double? = null) {
    onCommand?.invoke(command, positionSec)
  }

  fun apply(i: Info) {
    val s = session ?: return
    val meta = MediaMetadata.Builder()
      .putString(MediaMetadata.METADATA_KEY_TITLE, i.title)
      .putString(MediaMetadata.METADATA_KEY_ARTIST, i.artist)
      .putLong(MediaMetadata.METADATA_KEY_DURATION, (i.durationSec * 1000).toLong())
    artwork(i.artworkPath)?.let { meta.putBitmap(MediaMetadata.METADATA_KEY_ART, it) }
    s.setMetadata(meta.build())
    s.setPlaybackState(
      PlaybackState.Builder()
        .setActions(
          PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
            PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_STOP,
        )
        // Android 13 以降のメディア操作は、前後の曲が無いときこの 2 つを左右に置く【仮説: 実機で確認】
        .addCustomAction(PlaybackState.CustomAction.Builder(CUSTOM_REWIND, i.labels.rewind, android.R.drawable.ic_media_rew).build())
        .addCustomAction(PlaybackState.CustomAction.Builder(CUSTOM_FORWARD, i.labels.forward, android.R.drawable.ic_media_ff).build())
        // 位置は状態が変わったときだけ届く。間は OS が速度と更新時刻から進める
        .setState(
          if (i.playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
          (i.positionSec * 1000).toLong(),
          if (i.playing) 1f else 0f,
          SystemClock.elapsedRealtime(),
        )
        .build(),
    )
    val n = buildNotification(i, s)
    if (foreground) {
      (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION_ID, n)
    } else {
      startInForeground(n)
    }
  }

  fun shutdown() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    foreground = false
    session?.isActive = false
    stopSelf()
  }

  private fun startInForeground(n: Notification) {
    startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    foreground = true
  }

  private fun ensureChannel(labels: Labels?): String {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    // 同じ ID なら名前と説明だけが更新される（他の設定は利用者のものが残る）
    val ch = NotificationChannel(CHANNEL_ID, labels?.channelName ?: "Playback", NotificationManager.IMPORTANCE_LOW).apply {
      labels?.let { description = it.channelDescription }
      setSound(null, null)
      setShowBadge(false)
    }
    nm.createNotificationChannel(ch)
    return CHANNEL_ID
  }

  private fun buildNotification(i: Info, s: MediaSession): Notification {
    val l = i.labels
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    val actions = listOf(
      action(android.R.drawable.ic_media_rew, l.rewind, "skipBackward", 1),
      if (i.playing) action(android.R.drawable.ic_media_pause, l.pause, "pause", 2)
      else action(android.R.drawable.ic_media_play, l.play, "play", 3),
      action(android.R.drawable.ic_media_ff, l.forward, "skipForward", 4),
      action(android.R.drawable.ic_menu_close_clear_cancel, l.stop, "stop", 5),
    )
    return Notification.Builder(this, ensureChannel(l))
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(i.title)
      .setContentText(i.artist)
      .apply { artwork(i.artworkPath)?.let { setLargeIcon(it) } }
      .apply { if (launch != null) setContentIntent(launch) }
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .setOngoing(i.playing)
      .setCategory(Notification.CATEGORY_TRANSPORT)
      .apply { actions.forEach { addAction(it) } }
      .setStyle(Notification.MediaStyle().setMediaSession(s.sessionToken).setShowActionsInCompactView(0, 1, 2))
      .build()
  }

  private fun action(icon: Int, title: String, command: String, requestCode: Int): Notification.Action {
    val intent = Intent(this, NowPlayingService::class.java).setAction(ACTION_COMMAND).putExtra(EXTRA_COMMAND, command)
    val pi = PendingIntent.getService(this, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return Notification.Action.Builder(Icon.createWithResource(this, icon), title, pi).build()
  }

  /** 番組のアートワーク。通知に十分な大きさ（512px 程度）まで縮めて読む。 */
  private fun artwork(path: String?): Bitmap? {
    if (path == null) {
      artPath = null
      art = null
      return null
    }
    if (path == artPath) return art
    artPath = path
    art = runCatching {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(path, bounds)
      var sample = 1
      while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 512) sample *= 2
      BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
    }.getOrNull()
    return art
  }
}
