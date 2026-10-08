package dev.nemotea.podsnow.audioengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/** AUDIO_DESIGN.md §8.2 のラウドネス処理。 */
class LoudnessTest {
  @get:Rule val tmp = TemporaryFolder()

  private val fs = TestSignals.FS

  private fun lufs(buf: FloatArray, channels: Int) =
    LoudnessMeter(fs, channels).apply { process(buf, buf.size / channels) }.integrated()

  @Test fun kWeightingMatchesBs1770CoefficientsAt48k() {
    // BS.1770-4 Table 1 / Table 2 の係数にインパルス応答で一致すること
    val shelf = Biquad.kShelf(48000)
    val hp = Biquad.kHighPass(48000)
    val b = doubleArrayOf(1.53512485958697, -2.69169618940638, 1.19839281085285)
    val a = doubleArrayOf(1.0, -1.69065929318241, 0.73248077421585)
    val y = DoubleArray(3); val x = doubleArrayOf(1.0, 0.0, 0.0)
    for (n in 0 until 3) {
      var acc = 0.0
      for (k in 0..n) acc += b[k] * x[n - k]
      for (k in 1..n) acc -= a[k] * y[n - k]
      y[n] = acc
      assertEquals(y[n], shelf.process(x[n]), 1e-9)
    }
    // RLB: 分子 1, -2, 1 → インパルス応答の先頭は 1, -2 - a1
    assertEquals(1.0, hp.process(1.0), 1e-12)
    assertEquals(-2.0 + 1.99004745483398, hp.process(0.0), 1e-9)
  }

  @Test fun ebuTech3341Cases1to5() {
    val cases = listOf(
      TestSignals.ebuSines(-23.0 to 20.0) to -23.0,
      TestSignals.ebuSines(-33.0 to 20.0) to -33.0,
      TestSignals.ebuSines(-36.0 to 10.0, -23.0 to 60.0, -36.0 to 10.0) to -23.0,
      TestSignals.ebuSines(-72.0 to 10.0, -36.0 to 10.0, -23.0 to 60.0, -36.0 to 10.0, -72.0 to 10.0) to -23.0,
      TestSignals.ebuSines(-26.0 to 20.0, -20.0 to 20.1, -26.0 to 20.0) to -23.0,
    )
    for ((i, c) in cases.withIndex()) assertEquals("case ${i + 1}", c.second, lufs(c.first, 2), 0.1)
  }

  @Test fun monoSineAtHalfScaleIsMinus9Point03() {
    val x = FloatArray(fs * 4) { (0.5 * sin(2 * PI * 997 * it / fs)).toFloat() }
    assertEquals(-9.03, lufs(x, 1), 0.02)
  }

  @Test fun sameSignalOnBothSidesIs3LuLouderThanMono() {
    val mono = FloatArray(fs * 4) { (0.5 * sin(2 * PI * 1000 * it / fs)).toFloat() }
    val stereo = FloatArray(fs * 8) { mono[it / 2] }
    assertEquals(10 * Math.log10(2.0), lufs(stereo, 2) - lufs(mono, 1), 0.02)
  }

  @Test fun truePeakOfSinesIsWithin0Point1Db() {
    for ((hz, ph) in listOf(12000.0 to PI / 4, 8000.0 to PI / 6, 997.0 to 0.3, 5000.0 to 0.3, 11000.0 to 0.7, 15000.0 to 0.1)) {
      // 立ち上がりの波打ちを避けるため 10 ms でフェードイン
      val x = FloatArray(fs) { (minOf(1.0, it / 480.0) * 0.5 * sin(2 * PI * hz * it / fs + ph)).toFloat() }
      val tp = linearToDb(TruePeakMeter(1).apply { process(x, x.size) }.peak.toDouble())
      assertEquals("$hz Hz", -6.02, tp, 0.1)
    }
  }

  @Test fun limiterKeepsInterSamplePeaksUnderCeilingAndIsLinked() {
    val n = fs
    val lim = Limiter(fs, -1.0, 2)
    val buf = FloatArray((n + lim.latency) * 2) { i ->
      val f = i / 2
      if (f >= n) 0f else {
        val s = sin(2 * PI * 12000 * f / fs + PI / 4)
        (if (i % 2 == 0) 3.0 * s else 0.3 * s).toFloat()
      }
    }
    lim.process(buf, n + lim.latency)
    val out = buf.copyOfRange(lim.latency * 2, buf.size)
    val tp = linearToDb(TruePeakMeter(2).apply { process(out, n) }.peak.toDouble())
    assertTrue("true peak $tp", tp <= -1.0)
    for (i in fs / 10 until n) {
      val l = out[i * 2]; val r = out[i * 2 + 1]
      if (abs(l) > 0.05f) assertEquals(0.1f, r / l, 1e-3f)
    }
  }

  @Test fun limiterIsTransparentBelowCeilingAndDelaysByLatency() {
    val lim = Limiter(fs, -1.0, 1)
    val buf = FloatArray(fs) { if (it == 1000) 0.5f else 0f }
    lim.process(buf, buf.size)
    assertEquals(0.5f, buf[1000 + lim.latency])
  }

  private fun renderFile(peak: Double, seed: Long): Triple<LoudnessRenderer, Double, OutputMeasure> {
    val sig = TestSignals.speechLike(30, peak, seed)
    val file = tmp.newFile("speech-$seed.wav")
    TestSignals.writeWav(file, 1, sig.size) { f, _ -> sig[f] }
    val doc = RenderDocument.parse(
      """{"sampleRate":48000,"channels":2,"totalFrames":${sig.size},
        "voice":[{"path":"${file.absolutePath}","fileStart":0,"fileEnd":${sig.size},"tlStart":0,"gainDb":0}],
        "overlays":[],"ducking":{"enabled":false},
        "loudness":{"enabled":true,"targetLufs":-16,"truePeakDbtp":-1}}""",
    )
    Mixer(doc).use { m ->
      val r = LoudnessRenderer(doc, m)
      val g = r.solveGain()
      var frames = 0
      val out = r.render(g) { _, _, n -> frames += n }
      assertEquals(sig.size, frames)
      return Triple(r, g, out)
    }
  }

  @Test fun rendersSpeechToTargetLoudnessWithinCeiling() {
    for ((peak, seed) in listOf(0.25 to 1L, 0.7 to 3L)) {
      val (r, g, out) = renderFile(peak, seed)
      assertTrue("limiter re-measured (seed $seed)", r.trials > 0)
      assertTrue(g < LoudnessRenderer.MAX_GAIN_DB)
      assertEquals("output loudness (seed $seed)", -16.0, out.lufs, 0.2)
      assertTrue("output true peak ${out.truePeakDb}", out.truePeakDb <= -1.0)
    }
  }

  @Test fun tooQuietRecordingIsCappedAtPlus20Db() {
    val (_, g, out) = renderFile(0.02, 2L)
    assertEquals(LoudnessRenderer.MAX_GAIN_DB, g, 1e-9)
    assertTrue("output ${out.lufs}", out.lufs < -17)
    assertTrue(out.truePeakDb <= -1.0)
  }
}
