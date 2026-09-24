package dev.nemotea.podsnow.audioengine

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.sin

/** テスト用の信号と WAV。 */
object TestSignals {
  const val FS = 48000

  fun writeWav(file: File, channels: Int, frames: Int, sample: (frame: Int, channel: Int) -> Double) {
    val data = ByteBuffer.allocate(frames * channels * 2).order(ByteOrder.LITTLE_ENDIAN)
    for (i in 0 until frames) for (c in 0 until channels) {
      data.putShort((sample(i, c).coerceIn(-1.0, 1.0) * 32767).toInt().toShort())
    }
    val h = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    h.put("RIFF".toByteArray()).putInt(36 + frames * channels * 2).put("WAVE".toByteArray())
      .put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(channels.toShort()).putInt(FS)
      .putInt(FS * channels * 2).putShort((channels * 2).toShort()).putShort(16)
      .put("data".toByteArray()).putInt(frames * channels * 2)
    file.writeBytes(h.array() + data.array())
  }

  /** 1 kHz 正弦（dBFS はピーク振幅）を区間ごとに並べたステレオ。EBU Tech 3341 の試験信号。 */
  fun ebuSines(vararg segs: Pair<Double, Double>): FloatArray {
    val total = segs.sumOf { (it.second * FS).toInt() }
    val out = FloatArray(total * 2)
    var k = 0
    for ((db, sec) in segs) {
      val a = Math.pow(10.0, db / 20)
      repeat((sec * FS).toInt()) {
        val v = (a * sin(2 * PI * 1000 * k / FS)).toFloat()
        out[k * 2] = v; out[k * 2 + 1] = v; k++
      }
    }
    return out
  }

  /**
   * 声に近い信号（倍音 + 雑音、4 Hz の音節、ときどき無音、強い音節）。ピークが立ちやすい。
   * 決定的な疑似乱数で作るので、毎回同じ結果になる。
   */
  fun speechLike(seconds: Int, peak: Double, seed: Long): DoubleArray {
    val rnd = java.util.Random(seed)
    val n = seconds * FS
    val out = DoubleArray(n)
    var phase = 0.0
    var noise = 0.0
    var syllableGain = 1.0
    var voiced = true
    for (i in 0 until n) {
      val t = i.toDouble() / FS
      if (i % (FS / 4) == 0) syllableGain = Math.exp(rnd.nextGaussian() * 0.5)
      if (i % (FS / 2) == 0) voiced = rnd.nextDouble() < 0.8
      phase += 2 * PI * (120 + 30 * sin(2 * PI * 0.3 * t)) / FS
      var harm = 0.0
      for (k in 1..24) harm += sin(k * phase) / k
      noise = 0.9 * noise + rnd.nextGaussian() * 0.3
      val env = sin(2 * PI * 4 * t).let { it * it }
      out[i] = if (voiced) (harm * 0.2 + noise) * env * syllableGain else 0.0
    }
    val max = out.maxOf { Math.abs(it) }
    for (i in 0 until n) out[i] = out[i] / max * peak
    return out
  }
}
