package dev.nemotea.podsnow.audioengine

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.SonicAudioProcessor
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
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

/**
 * measuredLufs / measuredTruePeakDb は書き出したファイル（出力）の測定値。
 * inputLufs は調整前のミックス（ラウドネス調整が無効なら測らないので -120）。
 */
/**
 * 出力のサンプルレートへ変換してから内側のシンクへ渡す（AUDIO_DESIGN.md §8.1.1、Issue #174）。
 * 変換は Media3 の SonicAudioProcessor（線形補間）。自前で補間しない。
 * 高域がわずかに下がる（理論値で 15 kHz が約 -3 dB）のは受け入れる: 下げる変換で、劣化させたくなければ
 * 48 kHz を選べばよい（ユーザー判断 2026-10-03）。iOS は AVAudioConverter。
 */
class ResamplingSink(
  private val inner: PcmSink,
  from: Int,
  to: Int,
  private val channels: Int,
) : PcmSink {
  private val sonic = SonicAudioProcessor().apply {
    setOutputSampleRateHz(to)
    configure(AudioProcessor.AudioFormat(from, channels, C.ENCODING_PCM_16BIT))
    flush(AudioProcessor.StreamMetadata.DEFAULT)
  }
  private var input: ByteBuffer = ByteBuffer.allocateDirect(0).order(ByteOrder.nativeOrder())
  private var out = ShortArray(0)

  override fun write(pcm: ShortArray, frames: Int) {
    if (frames <= 0) return
    val bytes = frames * channels * 2
    if (input.capacity() < bytes) input = ByteBuffer.allocateDirect(bytes).order(ByteOrder.nativeOrder())
    input.clear()
    input.asShortBuffer().put(pcm, 0, frames * channels)
    input.limit(bytes)
    sonic.queueInput(input)
    drain()
  }

  /** 変換済みの分（溜まっている分すべて）を内側へ渡す。 */
  private fun drain() {
    val buf = sonic.output
    val n = buf.remaining() / 2
    if (n == 0) return
    if (out.size < n) out = ShortArray(n)
    buf.asShortBuffer().get(out, 0, n)
    inner.write(out, n / channels)
  }

  override fun close() {
    try {
      // 変換器に残っている分を出し切ってから閉じる。getOutput は溜まっている分を一度に返す
      sonic.queueEndOfStream()
      drain()
    } finally {
      sonic.reset()
      inner.close()
    }
  }
}

data class RenderResult(
  val path: String,
  val frames: Long,
  val measuredLufs: Double,
  val measuredTruePeakDb: Double,
  val appliedGainDb: Double,
  val inputLufs: Double,
)

/**
 * オフラインレンダリング（AUDIO_DESIGN.md §8）。ラウドネス制御は LoudnessRenderer（§8.2）。
 * 測定パス → （必要ならリミッター込みの測り直し）→ ミックス → ゲイン → リミッター → エンコード
 * doc.gainDb があれば測定パスと測り直しを飛ばす（§8.4）。
 */
class RenderJob(
  private val doc: RenderDocument,
  private val outPath: String,
  private val format: String,
  private val bitrate: Int,
  /** 出力ファイルのサンプルレート。doc.sampleRate と違えば最後に変換する（AUDIO_DESIGN.md §8.1）。 */
  private val outputSampleRate: Int,
  private val onProgress: (Double, String) -> Unit,
) {
  @Volatile var cancelled = false
  private val block = 4096

  fun run(): RenderResult {
    Mixer(doc).use { mixer ->
      val r = LoudnessRenderer(doc, mixer, block, { cancelled }, onProgress)
      val ch = r.channels
      // 求めてあるゲイン（試聴と同じ値、AUDIO_DESIGN.md §8.4）があれば測定を飛ばす
      val cached = if (doc.loudnessEnabled) doc.gainDb else null
      val gainDb = cached ?: r.solveGain()
      val fileSink: PcmSink = if (format == "wav") WavSink(outPath, outputSampleRate, ch)
      else AacSink(outPath, outputSampleRate, ch, bitrate)
      val sink: PcmSink = if (outputSampleRate == doc.sampleRate) fileSink
      else ResamplingSink(fileSink, doc.sampleRate, outputSampleRate, ch)
      val pcm = ShortArray(block * ch)
      val out = sink.use {
        r.render(gainDb, measured = cached == null) { buf, offset, frames ->
          var k = 0
          for (i in offset * ch until (offset + frames) * ch) {
            pcm[k++] = (buf[i].coerceIn(-1f, 1f) * 32767f).roundToInt().toShort()
          }
          sink.write(pcm, frames)
        }
      }
      onProgress(1.0, "done")
      return RenderResult(outPath, doc.totalFrames, out.lufs, out.truePeakDb, gainDb, r.inputLufs)
    }
  }
}
