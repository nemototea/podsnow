package dev.nemotea.podsnow.audioengine

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

data class ImportedAsset(val path: String, val frames: Long, val sampleRate: Int, val channels: Int)

/**
 * 任意の音声ファイル（MP3 / AAC / WAV / FLAC / OGG など OS 標準デコーダ対応形式）を
 * 目標サンプルレートの 16 bit WAV に変換する（REQUIREMENTS.md FR-AST-3）。
 * リサンプリングは線形補間【仮説: 品質が問題なら windowed sinc に置き換える】。
 */
object AssetImporter {
  fun import(src: String, dst: String, targetRate: Int, targetChannels: Int, onProgress: ((Double) -> Unit)? = null): ImportedAsset {
    val extractor = MediaExtractor()
    extractor.setDataSource(src)
    var trackIdx = -1
    var fmt: MediaFormat? = null
    for (i in 0 until extractor.trackCount) {
      val f = extractor.getTrackFormat(i)
      if (f.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) { trackIdx = i; fmt = f; break }
    }
    require(trackIdx >= 0 && fmt != null) { "no audio track: $src" }
    extractor.selectTrack(trackIdx)
    val mime = fmt.getString(MediaFormat.KEY_MIME)!!
    val durationUs = if (fmt.containsKey(MediaFormat.KEY_DURATION)) fmt.getLong(MediaFormat.KEY_DURATION) else 0L
    val codec = MediaCodec.createDecoderByType(mime)
    codec.configure(fmt, null, null, 0)
    codec.start()

    val sink = WavSink(dst, targetRate, targetChannels)
    val resampler = Resampler(targetRate, targetChannels)
    val info = MediaCodec.BufferInfo()
    var inputDone = false
    var outputDone = false
    var srcRate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    var srcCh = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    var pcmEncoding = AudioFormat.ENCODING_PCM_16BIT
    try {
      while (!outputDone) {
        if (!inputDone) {
          val idx = codec.dequeueInputBuffer(10_000)
          if (idx >= 0) {
            val ib = codec.getInputBuffer(idx)!!
            val n = extractor.readSampleData(ib, 0)
            if (n < 0) {
              codec.queueInputBuffer(idx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true
            } else {
              codec.queueInputBuffer(idx, 0, n, extractor.sampleTime, 0)
              if (durationUs > 0) onProgress?.invoke((extractor.sampleTime.toDouble() / durationUs).coerceIn(0.0, 1.0))
              extractor.advance()
            }
          }
        }
        val oidx = codec.dequeueOutputBuffer(info, 10_000)
        when {
          oidx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            val of = codec.outputFormat
            srcRate = of.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            srcCh = of.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            if (of.containsKey(MediaFormat.KEY_PCM_ENCODING)) pcmEncoding = of.getInteger(MediaFormat.KEY_PCM_ENCODING)
          }
          oidx >= 0 -> {
            val ob = codec.getOutputBuffer(oidx)!!
            ob.position(info.offset); ob.limit(info.offset + info.size)
            if (info.size > 0) {
              val floats = toFloat(ob, pcmEncoding, srcCh)
              resampler.push(floats, srcRate, srcCh, sink)
            }
            codec.releaseOutputBuffer(oidx, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
          }
        }
      }
      resampler.flush(sink)
    } finally {
      codec.stop(); codec.release(); extractor.release(); sink.close()
    }
    return ImportedAsset(dst, resampler.emitted, targetRate, targetChannels)
  }

  /** デコード出力を [frame][channel] のインターリーブ Float に。 */
  private fun toFloat(bb: ByteBuffer, encoding: Int, channels: Int): FloatArray {
    val le = bb.order(ByteOrder.LITTLE_ENDIAN)
    return when (encoding) {
      AudioFormat.ENCODING_PCM_FLOAT -> FloatArray(le.remaining() / 4) { le.getFloat(le.position() + it * 4) }
      else -> FloatArray(le.remaining() / 2) { le.getShort(le.position() + it * 2) / 32768f }
    }
  }
}

/** 線形補間リサンプラ + チャンネル変換。 */
class Resampler(private val outRate: Int, private val outCh: Int) {
  var emitted = 0L
    private set
  private var frac = 0.0
  private var last: FloatArray? = null
  private val pcm = ShortArray(8192 * 2)

  fun push(inter: FloatArray, inRate: Int, inCh: Int, sink: PcmSink) {
    val inFrames = inter.size / inCh
    if (inFrames == 0) return
    // 入力を outCh に変換したモノ/ステレオ配列に
    val conv = FloatArray(inFrames * outCh)
    for (f in 0 until inFrames) {
      if (outCh == 1) {
        var acc = 0f; for (c in 0 until inCh) acc += inter[f * inCh + c]; conv[f] = acc / inCh
      } else {
        conv[f * 2] = inter[f * inCh]
        conv[f * 2 + 1] = if (inCh >= 2) inter[f * inCh + 1] else inter[f * inCh]
      }
    }
    val step = inRate.toDouble() / outRate
    val prev = last
    // 仮想入力列: v[-1] = 前チャンクの最終フレーム、v[0..inFrames-1] = conv
    fun v(idx: Int, c: Int): Float = if (idx < 0) (prev?.get(c) ?: conv[c]) else conv[idx * outCh + c]
    var pos = if (prev != null) frac - 1.0 else frac
    var k = 0
    while (pos <= inFrames - 1.0) {
      val i = kotlin.math.floor(pos).toInt()
      val t = (pos - i).toFloat()
      for (c in 0 until outCh) {
        val a = v(i, c)
        val b = if (i + 1 <= inFrames - 1) v(i + 1, c) else a
        pcm[k++] = ((a + (b - a) * t).coerceIn(-1f, 1f) * 32767f).toInt().toShort()
      }
      if (k >= pcm.size - outCh) { sink.write(pcm, k / outCh); emitted += k / outCh; k = 0 }
      pos += step
    }
    if (k > 0) { sink.write(pcm, k / outCh); emitted += k / outCh }
    frac = pos - (inFrames - 1)
    last = FloatArray(outCh) { c -> conv[(inFrames - 1) * outCh + c] }
  }

  @Suppress("UNUSED_PARAMETER")
  fun flush(sink: PcmSink) {
    // 最終フレームは push 内で出力済み（pos <= inFrames-1 まで回す）ので何もしない
  }
}
