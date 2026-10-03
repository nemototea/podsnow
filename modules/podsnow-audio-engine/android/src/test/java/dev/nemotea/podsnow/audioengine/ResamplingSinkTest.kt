package dev.nemotea.podsnow.audioengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/** 書き出しのサンプルレート変換（AUDIO_DESIGN.md §8.1.1、Issue #174）。 */
class ResamplingSinkTest {
  /** 受け取った PCM をためるだけのシンク。 */
  private class Collect(private val channels: Int) : PcmSink {
    val samples = ArrayList<Short>()
    var closed = false
    override fun write(pcm: ShortArray, frames: Int) {
      for (i in 0 until frames * channels) samples.add(pcm[i])
    }
    override fun close() { closed = true }
  }

  /** 1 kHz 正弦（-6 dBFS）のステレオを、ブロックに分けて流す。 */
  private fun run(seconds: Int, block: Int): Collect {
    val ch = 2
    val total = 48000 * seconds
    val sink = Collect(ch)
    val r = ResamplingSink(sink, 48000, 44100, ch)
    val pcm = ShortArray(block * ch)
    var pos = 0
    while (pos < total) {
      val n = minOf(block, total - pos)
      for (i in 0 until n) {
        val v = (0.5 * sin(2 * PI * 1000 * (pos + i) / 48000) * 32767).toInt().toShort()
        pcm[i * 2] = v; pcm[i * 2 + 1] = v
      }
      r.write(pcm, n)
      pos += n
    }
    r.close()
    return sink
  }

  @Test fun keepsTheDurationAt441k() {
    val out = run(seconds = 2, block = 4096)
    val frames = out.samples.size / 2
    assertTrue("frames=$frames", abs(frames - 44100 * 2) <= 2)
    assertTrue(out.closed)
  }

  @Test fun keepsThePitch() {
    val out = run(seconds = 1, block = 1000)
    val left = out.samples.filterIndexed { i, _ -> i % 2 == 0 }
    // 立ち上がりのゼロ交差を数える（1 kHz なら 1 秒で 1000 回）
    var crossings = 0
    for (i in 1 until left.size) if (left[i - 1] < 0 && left[i] >= 0) crossings++
    assertTrue("crossings=$crossings", abs(crossings - 1000) <= 2)
  }

  @Test fun keepsTheLevelAt1kHz() {
    val out = run(seconds = 1, block = 4096)
    val left = out.samples.filterIndexed { i, _ -> i % 2 == 0 }
    val peak = left.drop(1000).dropLast(1000).maxOf { it.toInt() }
    // 線形補間の 1 kHz の減衰は 0.1 dB 未満
    assertEquals(0.5 * 32767, peak.toDouble(), 0.02 * 32767)
  }
}
