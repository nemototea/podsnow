package dev.nemotea.podsnow.audioengine

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Process
import kotlin.math.roundToInt

/**
 * タイムラインのリアルタイム再生（AUDIO_DESIGN.md §7）。
 * 書き出しと同じ Mixer から PCM を生成し AudioTrack 1 本に書く。
 */
class TimelinePlayer(private val emit: (String, Map<String, Any?>) -> Unit) {
  private var doc: RenderDocument? = null
  private var mixer: Mixer? = null
  private var track: AudioTrack? = null
  private var thread: Thread? = null
  @Volatile private var playing = false
  @Volatile private var position = 0L
  @Volatile private var seekTo = -1L
  private val block = 2048

  val isPlaying: Boolean get() = playing
  val currentFrame: Long get() = position

  @Synchronized
  fun load(d: RenderDocument) {
    stopThread()
    mixer?.close()
    doc = d
    mixer = Mixer(d)
    position = 0
  }

  @Synchronized
  fun play(atFrame: Long?) {
    val d = doc ?: throw IllegalStateException("no timeline loaded")
    if (atFrame != null) position = atFrame.coerceIn(0, d.totalFrames)
    if (playing) return
    val minBuf = AudioTrack.getMinBufferSize(d.sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val t = AudioTrack.Builder()
      .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
      .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(d.sampleRate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
      .setBufferSizeInBytes(maxOf(minBuf, block * 2 * 4))
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
    track = t
    playing = true
    mixer?.reset()
    t.play()
    thread = Thread({ loop(t, d) }, "podsnow-player").also { it.start() }
    emit("onPlaybackState", mapOf("playing" to true, "frame" to position))
  }

  @Synchronized
  fun pause() {
    if (!playing) return
    stopThread()
    emit("onPlaybackState", mapOf("playing" to false, "frame" to position))
  }

  @Synchronized
  fun seek(frame: Long) {
    val d = doc ?: return
    val f = frame.coerceIn(0, d.totalFrames)
    if (playing) seekTo = f else position = f
    emit("onPosition", mapOf("frame" to f))
  }

  @Synchronized
  fun release() {
    stopThread()
    mixer?.close(); mixer = null; doc = null
  }

  private fun stopThread() {
    playing = false
    thread?.let { runCatching { it.join(1000) } }
    thread = null
    track?.let { runCatching { it.stop() }; it.release() }
    track = null
  }

  private fun loop(t: AudioTrack, d: RenderDocument) {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    val m = mixer ?: return
    val buf = FloatArray(block)
    val pcm = ShortArray(block)
    var sincePos = 0
    while (playing) {
      val s = seekTo
      if (s >= 0) { position = s; seekTo = -1; m.reset(); t.flush() }
      if (position >= d.totalFrames) {
        playing = false
        emit("onPlaybackState", mapOf("playing" to false, "frame" to position, "ended" to true))
        break
      }
      val n = minOf(block.toLong(), d.totalFrames - position).toInt()
      m.render(position, n, buf)
      for (i in 0 until n) pcm[i] = (buf[i].coerceIn(-1f, 1f) * 32767f).roundToInt().toShort()
      val written = t.write(pcm, 0, n, AudioTrack.WRITE_BLOCKING)
      if (written < 0) { emit("onError", mapOf("message" to "AudioTrack write $written")); playing = false; break }
      position += written
      sincePos += written
      if (sincePos >= d.sampleRate / 10) { sincePos = 0; emit("onPosition", mapOf("frame" to position)) }
    }
  }
}
