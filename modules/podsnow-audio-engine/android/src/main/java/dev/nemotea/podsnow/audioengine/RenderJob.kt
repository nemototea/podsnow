package dev.nemotea.podsnow.audioengine

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.roundToInt

/** 書き出し先のエンコーダ抽象。write は Int16 インターリーブ PCM。 */
interface PcmSink : AutoCloseable {
  fun write(pcm: ShortArray, frames: Int)
}

/** 16 bit PCM WAV。 */
class WavSink(path: String, private val sampleRate: Int, private val channels: Int) : PcmSink {
  private val file: RandomAccessFile
  private var dataBytes = 0L
  init {
    File(path).parentFile?.mkdirs()
    file = RandomAccessFile(File(path), "rw")
    file.setLength(0)
    file.write(header(null))
  }
  private fun header(data: Long?): ByteArray {
    val b = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    val ds = (data ?: 0L).toInt()
    b.put("RIFF".toByteArray()).putInt(ds + 36).put("WAVE".toByteArray()).put("fmt ".toByteArray())
      .putInt(16).putShort(1).putShort(channels.toShort()).putInt(sampleRate).putInt(sampleRate * channels * 2)
      .putShort((channels * 2).toShort()).putShort(16).put("data".toByteArray()).putInt(ds)
    return b.array()
  }
  override fun write(pcm: ShortArray, frames: Int) {
    val bytes = ByteArray(frames * channels * 2)
    ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().put(pcm, 0, frames * channels)
    file.write(bytes)
    dataBytes += bytes.size
  }
  override fun close() {
    file.seek(0); file.write(header(dataBytes)); file.fd.sync(); file.close()
  }
}

/** AAC-LC を MediaCodec でエンコードし MediaMuxer で .m4a に書く。【確認済み】Android は AAC エンコーダを標準搭載。 */
class AacSink(path: String, private val sampleRate: Int, private val channels: Int, bitrate: Int) : PcmSink {
  private val codec: MediaCodec
  private val muxer: MediaMuxer
  private var track = -1
  private var muxerStarted = false
  private val info = MediaCodec.BufferInfo()
  private var presentationFrames = 0L
  private val frameBytes = channels * 2

  init {
    File(path).parentFile?.mkdirs()
    val fmt = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channels).apply {
      setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
    }
    codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    codec.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    codec.start()
    muxer = MediaMuxer(path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
  }

  override fun write(pcm: ShortArray, frames: Int) {
    val bytes = ByteArray(frames * frameBytes)
    ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().put(pcm, 0, frames * channels)
    var offset = 0
    while (offset < bytes.size) {
      val idx = codec.dequeueInputBuffer(10_000)
      if (idx >= 0) {
        val ib = codec.getInputBuffer(idx)!!
        ib.clear()
        val n = minOf(ib.capacity(), bytes.size - offset)
        ib.put(bytes, offset, n)
        val pts = presentationFrames * 1_000_000L / sampleRate
        codec.queueInputBuffer(idx, 0, n, pts, 0)
        presentationFrames += n / frameBytes
        offset += n
      }
      drain(false)
    }
  }

  private fun drain(eos: Boolean) {
    while (true) {
      val idx = codec.dequeueOutputBuffer(info, if (eos) 10_000 else 0)
      when {
        idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          track = muxer.addTrack(codec.outputFormat)
          muxer.start(); muxerStarted = true
        }
        idx == MediaCodec.INFO_TRY_AGAIN_LATER -> if (!eos) return
        idx >= 0 -> {
          val ob = codec.getOutputBuffer(idx)!!
          if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
          if (info.size > 0 && muxerStarted) {
            ob.position(info.offset); ob.limit(info.offset + info.size)
            muxer.writeSampleData(track, ob, info)
          }
          codec.releaseOutputBuffer(idx, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
        }
        else -> if (!eos) return
      }
    }
  }

  override fun close() {
    var idx = codec.dequeueInputBuffer(100_000)
    while (idx < 0) idx = codec.dequeueInputBuffer(100_000)
    codec.queueInputBuffer(idx, 0, 0, presentationFrames * 1_000_000L / sampleRate, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
    drain(true)
    codec.stop(); codec.release()
    if (muxerStarted) muxer.stop()
    muxer.release()
  }
}

data class RenderResult(val path: String, val frames: Long, val measuredLufs: Double, val measuredTruePeakDb: Double, val appliedGainDb: Double)

/**
 * オフラインレンダリング（AUDIO_DESIGN.md §8）。
 * pass 1: ミックスしながら統合ラウドネスとトゥルーピークを測定 → ゲイン決定
 * pass 2: ミックス → ゲイン → リミッター → エンコード
 */
class RenderJob(
  private val doc: RenderDocument,
  private val outPath: String,
  private val format: String,
  private val bitrate: Int,
  private val onProgress: (Double, String) -> Unit,
) {
  @Volatile var cancelled = false
  private val block = 4096

  fun run(): RenderResult {
    val total = doc.totalFrames
    var gainDb = 0.0
    var lufs = -120.0
    var tp = -120.0
    Mixer(doc).use { mixer ->
      val ch = mixer.channels
      if (doc.loudnessEnabled) {
        val meter = LoudnessMeter(doc.sampleRate, ch)
        val tpm = TruePeakMeter(ch)
        val buf = FloatArray(block * ch)
        var f = 0L
        while (f < total) {
          if (cancelled) throw InterruptedException("cancelled")
          val n = minOf(block.toLong(), total - f).toInt()
          mixer.render(f, n, buf)
          meter.process(buf, n)
          tpm.process(buf, n)
          f += n
          if ((f / block) % 50 == 0L) onProgress(0.5 * f / max(1, total), "measuring")
        }
        lufs = meter.integrated()
        tp = linearToDb(tpm.peak.toDouble())
        if (lufs > -100) {
          gainDb = doc.targetLufs - lufs
          // ゲイン後のトゥルーピークが天井を大きく超えるならリミッターに任せるが、+20 dB 以上の持ち上げはしない
          gainDb = gainDb.coerceIn(-40.0, 20.0)
        }
        mixer.reset()
      }
      val gain = dbToLinear(gainDb)
      val limiter = if (doc.loudnessEnabled) Limiter(doc.sampleRate, doc.truePeakDbtp, ch) else null
      val latency = limiter?.latency ?: 0
      val sink: PcmSink = if (format == "wav") WavSink(outPath, doc.sampleRate, ch)
      else AacSink(outPath, doc.sampleRate, ch, bitrate)
      val buf = FloatArray(block * ch)
      val pcm = ShortArray(block * ch)
      var f = 0L
      var emitted = 0L
      val renderEnd = total + latency
      sink.use {
        while (f < renderEnd) {
          if (cancelled) throw InterruptedException("cancelled")
          val n = minOf(block.toLong(), renderEnd - f).toInt()
          mixer.render(f, n, buf)
          for (i in 0 until n * ch) buf[i] *= gain
          limiter?.process(buf, n)
          // 先頭 latency サンプルは遅延分なので捨て、total を超える分も捨てる
          var outStart = 0
          if (f < latency) outStart = minOf(n, (latency - f).toInt())
          var outCount = n - outStart
          if (emitted + outCount > total) outCount = (total - emitted).toInt()
          if (outCount > 0) {
            var k = 0
            for (i in outStart * ch until (outStart + outCount) * ch) {
              pcm[k++] = (buf[i].coerceIn(-1f, 1f) * 32767f).roundToInt().toShort()
            }
            sink.write(pcm, outCount)
            emitted += outCount
          }
          f += n
          if ((f / block) % 50 == 0L) onProgress((if (doc.loudnessEnabled) 0.5 else 0.0) + (if (doc.loudnessEnabled) 0.5 else 1.0) * f / max(1, renderEnd), "encoding")
        }
      }
      onProgress(1.0, "done")
      return RenderResult(outPath, total, lufs, tp, gainDb)
    }
  }
}
