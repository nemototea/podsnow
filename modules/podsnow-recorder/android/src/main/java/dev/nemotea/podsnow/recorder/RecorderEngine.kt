package dev.nemotea.podsnow.recorder

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.StatFs
import java.io.File
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.sqrt

/**
 * AudioRecord から Int16 PCM を読み出して WavWriter に書く録音エンジン（AUDIO_DESIGN.md §3.2, §4）。
 * Audio Focus の喪失を割り込み、AudioDeviceCallback をルート変更として通知する。
 * フォアグラウンドサービス（RecorderService）はプロセス維持と通知のみを担う。
 */
class RecorderEngine(private val context: Context, private val emit: (String, Map<String, Any?>) -> Unit) {
  enum class State(val raw: String) {
    IDLE("idle"), PREPARED("prepared"), RECORDING("recording"), PAUSED("paused"), INTERRUPTED("interrupted"), STOPPING("stopping")
  }

  data class Config(
    val sampleRate: Int = 48000,
    val channels: Int = 1,
    val inputUid: String? = null,
    val diskLowThresholdBytes: Long = 30L * 1024 * 1024,
    val headerFlushIntervalMs: Long = 1000,
    val levelIntervalMs: Long = 50,
    val audioSource: String = "voice_recognition",
  )

  @Volatile var state: State = State.IDLE
    private set(v) {
      if (field != v) {
        field = v
        emit("onStateChange", mapOf("state" to v.raw))
      }
    }

  var config = Config()
    private set

  private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val main = Handler(Looper.getMainLooper())
  private var record: AudioRecord? = null
  private var writer: WavWriter? = null
  private var thread: Thread? = null
  @Volatile private var running = false
  @Volatile private var paused = false
  private var focusRequest: AudioFocusRequest? = null
  private var hasFocus = false
  private var deviceCallback: AudioDeviceCallback? = null

  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    main.post { handleFocusChange(change) }
  }

  // ---- Public API（メインスレッドから呼ぶ）----

  fun prepare(c: Config) {
    check(state == State.IDLE || state == State.PREPARED) { "prepare: invalid state ${state.raw}" }
    config = c
    registerDeviceCallback()
    state = State.PREPARED
  }

  fun start(path: String) {
    check(state == State.PREPARED || state == State.INTERRUPTED) { "start: invalid state ${state.raw}" }
    if (!requestFocus()) throw IllegalStateException("audio focus denied")
    val rec = createRecord()
    val w = WavWriter(path, config.sampleRate, config.channels, config.headerFlushIntervalMs)
    writer = w
    record = rec
    paused = false
    running = true
    RecorderService.start(context)
    rec.startRecording()
    if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      running = false
      rec.release(); record = null
      w.finalizeFile(); writer = null
      throw IllegalStateException("AudioRecord failed to start (busy or permission?)")
    }
    thread = Thread({ readLoop(rec, w) }, "podsnow-recorder").also { it.start() }
    state = State.RECORDING
  }

  fun pause() {
    check(state == State.RECORDING) { "pause: invalid state ${state.raw}" }
    paused = true
    writer?.flushHeader()
    state = State.PAUSED
  }

  fun resume() {
    check(state == State.PAUSED) { "resume: invalid state ${state.raw}" }
    paused = false
    state = State.RECORDING
  }

  fun stop(reason: String = "stop"): Map<String, Any?> {
    check(state == State.RECORDING || state == State.PAUSED || state == State.INTERRUPTED) { "stop: invalid state ${state.raw}" }
    state = State.STOPPING
    val result = closeCurrent(reason)
    RecorderService.stop(context)
    state = State.PREPARED
    return result ?: emptyMap()
  }

  fun release() {
    if (state == State.RECORDING || state == State.PAUSED || state == State.INTERRUPTED) {
      runCatching { stop("stop") }
    }
    abandonFocus()
    unregisterDeviceCallback()
    RecorderService.stop(context)
    state = State.IDLE
  }

  val frames: Long get() = writer?.frames ?: 0

  fun setInput(uid: String?) {
    config = config.copy(inputUid = uid)
    val rec = record ?: return
    if (Build.VERSION.SDK_INT >= 23) {
      rec.preferredDevice = findDevice(uid)
    }
  }

  // ---- 読み出しループ（専用スレッド）----

  private fun readLoop(rec: AudioRecord, w: WavWriter) {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    val bufBytes = bufferSize()
    val buf = ByteArray(bufBytes)
    var lastLevel = 0L
    var lastDisk = 0L
    while (running) {
      val n = rec.read(buf, 0, buf.size)
      if (n < 0) {
        emitError("read: $n", "read")
        main.post { runCatching { stop("error") } }
        return
      }
      if (n == 0 || paused) continue
      try {
        w.append(buf, n)
      } catch (e: Exception) {
        emitError("write: ${e.message}", "write")
        main.post { runCatching { stop("error") } }
        return
      }
      val now = System.currentTimeMillis()
      if (now - lastLevel >= config.levelIntervalMs) {
        lastLevel = now
        val (peak, rms) = levels(buf, n)
        emit("onLevel", mapOf("peakDb" to db(peak), "rmsDb" to db(rms), "frames" to w.frames, "clipped" to (peak >= 0.99f)))
      }
      if (now - lastDisk >= 5000) {
        lastDisk = now
        val free = availableBytes(w.path)
        if (free in 0 until config.diskLowThresholdBytes) {
          emit("onDiskLow", mapOf("availableBytes" to free))
          main.post { runCatching { stop("disk_low") } }
          return
        }
      }
    }
  }

  private fun closeCurrent(reason: String): Map<String, Any?>? {
    running = false
    thread?.let { t -> runCatching { t.join(2000) } }
    thread = null
    record?.let { r ->
      runCatching { if (r.recordingState == AudioRecord.RECORDSTATE_RECORDING) r.stop() }
      r.release()
    }
    record = null
    val w = writer ?: return null
    writer = null
    try {
      w.finalizeFile()
    } catch (e: Exception) {
      emitError("finalize: ${e.message}", "finalize")
      runCatching { WavWriter.repairHeader(w.path) }
    }
    val result = mapOf(
      "path" to w.path, "frames" to w.frames, "bytes" to w.fileBytes,
      "sampleRate" to w.sampleRate, "channels" to w.channels,
    )
    emit("onSegmentClosed", result + ("reason" to reason))
    return result
  }

  // ---- AudioRecord ----

  @SuppressLint("MissingPermission")
  private fun createRecord(): AudioRecord {
    val channelMask = if (config.channels == 2) AudioFormat.CHANNEL_IN_STEREO else AudioFormat.CHANNEL_IN_MONO
    val source = when (config.audioSource) {
      "mic" -> MediaRecorder.AudioSource.MIC
      "camcorder" -> MediaRecorder.AudioSource.CAMCORDER
      "unprocessed" -> if (Build.VERSION.SDK_INT >= 24 &&
        audioManager.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED) == "true"
      ) MediaRecorder.AudioSource.UNPROCESSED else MediaRecorder.AudioSource.VOICE_RECOGNITION
      else -> MediaRecorder.AudioSource.VOICE_RECOGNITION
    }
    val format = AudioFormat.Builder()
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
      .setSampleRate(config.sampleRate)
      .setChannelMask(channelMask)
      .build()
    val rec = AudioRecord.Builder()
      .setAudioSource(source)
      .setAudioFormat(format)
      .setBufferSizeInBytes(bufferSize() * 4)
      .build()
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      rec.release()
      throw IllegalStateException("AudioRecord init failed (${config.sampleRate} Hz, ${config.channels} ch)")
    }
    if (Build.VERSION.SDK_INT >= 23) {
      config.inputUid?.let { uid -> rec.preferredDevice = findDevice(uid) }
    }
    return rec
  }

  private fun bufferSize(): Int {
    val channelMask = if (config.channels == 2) AudioFormat.CHANNEL_IN_STEREO else AudioFormat.CHANNEL_IN_MONO
    val min = AudioRecord.getMinBufferSize(config.sampleRate, channelMask, AudioFormat.ENCODING_PCM_16BIT)
    val twentyMs = config.sampleRate * config.channels * 2 / 50
    return max(min, twentyMs)
  }

  // ---- Audio Focus（割り込み）----

  private fun requestFocus(): Boolean {
    val result = if (Build.VERSION.SDK_INT >= 26) {
      val attrs = android.media.AudioAttributes.Builder()
        .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
      val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(attrs)
        .setOnAudioFocusChangeListener(focusListener, main)
        .build()
      focusRequest = req
      audioManager.requestAudioFocus(req)
    } else {
      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
    }
    hasFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    return hasFocus
  }

  private fun abandonFocus() {
    if (!hasFocus) return
    if (Build.VERSION.SDK_INT >= 26) {
      focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
    } else {
      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(focusListener)
    }
    hasFocus = false
  }

  private fun handleFocusChange(change: Int) {
    when (change) {
      AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
        // 着信・他アプリの排他再生など。Segment を確定してから通知する。
        if (state == State.RECORDING || state == State.PAUSED) {
          state = State.STOPPING
          closeCurrent("interruption")
          state = State.INTERRUPTED
        }
        if (change == AudioManager.AUDIOFOCUS_LOSS) hasFocus = false
        emit("onInterruption", mapOf("type" to "began", "shouldResume" to false, "reason" to "focus_$change"))
      }
      AudioManager.AUDIOFOCUS_GAIN -> {
        emit("onInterruption", mapOf("type" to "ended", "shouldResume" to true))
      }
    }
  }

  // ---- 入力デバイス ----

  private fun registerDeviceCallback() {
    if (deviceCallback != null || Build.VERSION.SDK_INT < 23) return
    val cb = object : AudioDeviceCallback() {
      override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) {
        if (added.any { it.isSource }) emit("onRouteChange", mapOf("reason" to "new_device", "currentInput" to currentInput()))
      }
      override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) {
        if (removed.any { it.isSource }) emit("onRouteChange", mapOf("reason" to "old_device_unavailable", "currentInput" to currentInput()))
      }
    }
    audioManager.registerAudioDeviceCallback(cb, main)
    deviceCallback = cb
  }

  private fun unregisterDeviceCallback() {
    deviceCallback?.let { audioManager.unregisterAudioDeviceCallback(it) }
    deviceCallback = null
  }

  private fun findDevice(uid: String?): AudioDeviceInfo? {
    if (uid == null || Build.VERSION.SDK_INT < 23) return null
    return audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS).firstOrNull { it.id.toString() == uid }
  }

  fun availableInputs(): List<Map<String, Any?>> {
    if (Build.VERSION.SDK_INT < 23) return emptyList()
    return audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS).map { describe(it) }
  }

  fun currentInput(): Map<String, Any?>? {
    val rec = record
    if (Build.VERSION.SDK_INT >= 24 && rec != null) {
      rec.routedDevice?.let { return describe(it) }
    }
    return findDevice(config.inputUid)?.let { describe(it) }
      ?: availableInputs().firstOrNull { it["type"] == "builtin" }
  }

  fun isSpeakerOutput(): Boolean {
    if (Build.VERSION.SDK_INT < 23) return true
    val outs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    val external = outs.any {
      it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
        it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
        it.type == AudioDeviceInfo.TYPE_USB_HEADSET || it.type == AudioDeviceInfo.TYPE_USB_DEVICE
    }
    return !external
  }

  private fun describe(d: AudioDeviceInfo): Map<String, Any?> {
    val (type, low) = when (d.type) {
      AudioDeviceInfo.TYPE_BUILTIN_MIC -> "builtin" to false
      AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired" to false
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth" to true
      AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_ACCESSORY -> "usb" to false
      else -> "other" to false
    }
    return mapOf("uid" to d.id.toString(), "name" to d.productName.toString(), "type" to type, "lowQuality" to low)
  }

  // ---- Helpers ----

  private fun emitError(message: String, code: String) {
    emit("onError", mapOf("message" to message, "code" to code))
  }

  private fun levels(buf: ByteArray, len: Int): Pair<Float, Float> {
    var peak = 0f
    var sum = 0.0
    val n = len / 2
    var i = 0
    while (i + 1 < len) {
      val s = ((buf[i + 1].toInt() shl 8) or (buf[i].toInt() and 0xff)).toShort().toInt()
      val v = abs(s) / 32768f
      if (v > peak) peak = v
      sum += (v * v).toDouble()
      i += 2
    }
    return peak to (if (n > 0) sqrt(sum / n).toFloat() else 0f)
  }

  private fun db(linear: Float): Double = if (linear <= 0f) -120.0 else max(-120.0, 20 * log10(linear.toDouble()))

  companion object {
    fun availableBytes(path: String): Long = try {
      val dir = File(path).parentFile ?: File(path)
      StatFs(dir.absolutePath).availableBytes
    } catch (e: Exception) {
      -1
    }
  }
}
