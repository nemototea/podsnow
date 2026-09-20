package dev.nemotea.podsnow.audioengine

import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.sqrt

/**
 * 波形ピークキャッシュ（DATA_MODEL.md §2）。
 * 形式: "PKS1" | u32 sampleRate | u32 samplesPerSecond | u32 count | count × (i8 min, i8 max)
 */
object Peaks {
  fun generate(src: String, dst: String, samplesPerSecond: Int, onProgress: ((Double) -> Unit)? = null): Int {
    WavReader(src).use { r ->
      val bucket = maxOf(1, r.sampleRate / samplesPerSecond)
      val count = ((r.frames + bucket - 1) / bucket).toInt()
      File(dst).parentFile?.mkdirs()
      val tmp = File("$dst.tmp")
      BufferedOutputStream(FileOutputStream(tmp), 1 shl 16).use { out ->
        val head = ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN)
        head.put("PKS1".toByteArray(Charsets.US_ASCII)).putInt(r.sampleRate).putInt(samplesPerSecond).putInt(count)
        out.write(head.array())
        val chunkBuckets = 4096
        val buf = FloatArray(bucket * chunkBuckets)
        var frame = 0L
        var written = 0
        val pair = ByteArray(2)
        while (written < count) {
          val nb = minOf(chunkBuckets, count - written)
          r.readMono(frame, nb * bucket, buf)
          for (b in 0 until nb) {
            var mn = 1f; var mx = -1f
            val base = b * bucket
            for (i in 0 until bucket) { val v = buf[base + i]; if (v < mn) mn = v; if (v > mx) mx = v }
            pair[0] = (mn * 127f).toInt().coerceIn(-127, 127).toByte()
            pair[1] = (mx * 127f).toInt().coerceIn(-127, 127).toByte()
            out.write(pair)
          }
          written += nb
          frame += nb.toLong() * bucket
          onProgress?.invoke(written.toDouble() / count)
        }
      }
      tmp.renameTo(File(dst))
      return count
    }
  }
}

data class Range(val start: Long, val end: Long)

/** 無音検出: 窓 RMS がしきい値未満の区間が minDuration 以上続くものを返す（AUDIO_DESIGN.md §6.2）。 */
object SilenceDetector {
  fun detect(src: String, minDurationMs: Int, thresholdDb: Double, windowMs: Int = 20): List<Range> {
    WavReader(src).use { r ->
      val win = maxOf(1, r.sampleRate * windowMs / 1000)
      val minFrames = r.sampleRate.toLong() * minDurationMs / 1000
      val threshold = Math.pow(10.0, thresholdDb / 20).toFloat()
      val out = ArrayList<Range>()
      val chunkWins = 512
      val buf = FloatArray(win * chunkWins)
      var frame = 0L
      var silentStart = -1L
      while (frame < r.frames) {
        val nw = minOf(chunkWins.toLong(), (r.frames - frame + win - 1) / win).toInt()
        r.readMono(frame, nw * win, buf)
        for (w in 0 until nw) {
          var sum = 0.0
          val base = w * win
          for (i in 0 until win) { val v = buf[base + i]; sum += (v * v).toDouble() }
          val rms = sqrt(sum / win).toFloat()
          val at = frame + w.toLong() * win
          if (rms < threshold) {
            if (silentStart < 0) silentStart = at
          } else if (silentStart >= 0) {
            if (at - silentStart >= minFrames) out.add(Range(silentStart, at))
            silentStart = -1
          }
        }
        frame += nw.toLong() * win
      }
      if (silentStart >= 0 && r.frames - silentStart >= minFrames) out.add(Range(silentStart, r.frames))
      return out
    }
  }
}

internal fun dbToLinear(db: Double): Float = Math.pow(10.0, db / 20).toFloat()
internal fun linearToDb(v: Double): Double = if (v <= 0) -120.0 else maxOf(-120.0, 20 * log10(v))
internal fun absf(v: Float) = abs(v)
