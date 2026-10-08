package dev.nemotea.podsnow.audioengine

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper

/**
 * 再生中の割り込み（音声フォーカスの喪失）と出力の抜去（ACTION_AUDIO_BECOMING_NOISY）を見張る
 * （AUDIO_DESIGN.md §10.2 / §10.3）。止める・再開するの判断は JS の PlaybackService が持つ。
 * ここはイベントを送り、タイムライン再生だけはその場で止める（JS を待つ間にスピーカーから鳴らさないため）。
 *
 * - イベントは必ず「送ってから止める」。止めた通知（onPlaybackState）が先に届くと、PlaybackService は
 *   割り込みの時点で鳴っていなかったと判断し、割り込みのあとに再開しない。
 * - 音声フォーカスはタイムライン再生（AudioTrack）の分だけ取る。ファイル再生のフォーカスは expo-audio が持つ
 *   （こちらが取ると expo-audio のプレイヤーが喪失を受けて止まる）。
 * - 抜去はファイル再生でも止めたいので、生きている間はずっと受ける（expo-audio は扱わない）。
 */
class PlaybackSessionWatcher(
  private val context: Context,
  private val emit: (String, Map<String, Any?>) -> Unit,
  private val pausePlayer: () -> Unit,
) {
  private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val main = Handler(Looper.getMainLooper())
  private var focusRequest: AudioFocusRequest? = null
  private var hasFocus = false
  /** 一時的に失っている（AUDIOFOCUS_GAIN で戻る見込み）。この間はフォーカスを手放さない。 */
  private var transientLoss = false
  private var receiverRegistered = false

  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    when (change) {
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
        transientLoss = true
        emit("onPlaybackInterruption", mapOf("type" to "began", "shouldResume" to false))
        pausePlayer()
      }
      AudioManager.AUDIOFOCUS_LOSS -> {
        // 永続の喪失。GAIN は来ないので再開しない（https://developer.android.com/media/optimize/audio-focus）
        transientLoss = false
        emit("onPlaybackInterruption", mapOf("type" to "began", "shouldResume" to false))
        pausePlayer()
        abandonFocus()
      }
      AudioManager.AUDIOFOCUS_GAIN -> {
        if (transientLoss) {
          transientLoss = false
          emit("onPlaybackInterruption", mapOf("type" to "ended", "shouldResume" to true))
        }
      }
    }
  }

  private val noisyReceiver = object : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
      if (intent.action != AudioManager.ACTION_AUDIO_BECOMING_NOISY) return
      emit("onOutputDisconnected", mapOf("reason" to "becoming_noisy"))
      pausePlayer()
    }
  }

  fun start() {
    if (receiverRegistered) return
    val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
    if (Build.VERSION.SDK_INT >= 33) {
      context.registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      context.registerReceiver(noisyReceiver, filter)
    }
    receiverRegistered = true
  }

  fun stop() {
    if (receiverRegistered) {
      runCatching { context.unregisterReceiver(noisyReceiver) }
      receiverRegistered = false
    }
    abandonFocus()
  }

  /** タイムライン再生を始める前に呼ぶ。取れなければ false（通話中など。鳴らさない）。 */
  fun requestFocus(): Boolean {
    if (hasFocus) return true
    val result = if (Build.VERSION.SDK_INT >= 26) {
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
      val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(attrs)
        // 話し声はダッキングではなく一時停止する（同上）
        .setWillPauseWhenDucked(true)
        .setOnAudioFocusChangeListener(focusListener, main)
        .build()
      focusRequest = req
      audioManager.requestAudioFocus(req)
    } else {
      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
    }
    hasFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    transientLoss = false
    return hasFocus
  }

  /** 利用者の一時停止・鳴り終わり。割り込みで止めている間は GAIN を待つので手放さない。 */
  fun abandonFocusUnlessInterrupted() {
    if (!transientLoss) abandonFocus()
  }

  fun abandonFocus() {
    transientLoss = false
    if (!hasFocus) return
    if (Build.VERSION.SDK_INT >= 26) {
      focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
    } else {
      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(focusListener)
    }
    hasFocus = false
  }
}
