package dev.nemotea.podsnow.audioengine

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/** AUDIO_DESIGN.md §8.1 のチャンネルの扱い。 */
class MixerChannelsTest {
  @get:Rule val tmp = TemporaryFolder()

  private val n = TestSignals.FS
  private fun sine(i: Int) = 0.5 * sin(2 * PI * 1000 * i / TestSignals.FS)

  private fun wav(name: String, channels: Int, sample: (Int, Int) -> Double): File =
    tmp.newFile(name).also { TestSignals.writeWav(it, channels, n, sample) }

  private fun doc(channels: Int, voice: File, overlay: File? = null) = RenderDocument.parse(
    """{"sampleRate":48000,"channels":$channels,"totalFrames":$n,
      "voice":[{"path":"${voice.absolutePath}","fileStart":0,"fileEnd":$n,"tlStart":0,"gainDb":0}],
      "overlays":[${if (overlay != null) """{"path":"${overlay.absolutePath}","fileStart":0,"fileEnd":$n,"tlStart":0,"tlEnd":$n,"gainDb":0,"duck":false}""" else ""}],
      "ducking":{"enabled":false},"loudness":{"enabled":false}}""",
  )

  private fun render(d: RenderDocument): FloatArray = Mixer(d).use { m ->
    FloatArray(n * m.channels).also { m.render(0, n, it) }
  }

  @Test fun stereoExportKeepsLeftAndRight() {
    val out = render(doc(2, wav("l.wav", 2) { i, c -> if (c == 0) sine(i) else 0.0 }))
    assertTrue((0 until n).maxOf { abs(out[it * 2]) } > 0.49f)
    assertEquals(0f, (0 until n).maxOf { abs(out[it * 2 + 1]) })
  }

  @Test fun monoExportAveragesStereo() {
    val out = render(doc(1, wav("l.wav", 2) { i, c -> if (c == 0) sine(i) else 0.0 }))
    assertEquals(0.25f, out.maxOf { abs(it) }, 0.01f)
  }

  @Test fun monoSourceIsDuplicatedInStereo() {
    val out = render(doc(2, wav("m.wav", 1) { i, _ -> sine(i) }))
    for (i in 0 until n) assertEquals(out[i * 2], out[i * 2 + 1])
  }

  @Test fun overlaysMixPerChannel() {
    val out = render(doc(2, wav("l.wav", 2) { i, c -> if (c == 0) sine(i) else 0.0 }, wav("r.wav", 2) { i, c -> if (c == 1) sine(i) * 0.5 else 0.0 }))
    assertTrue((0 until n).maxOf { abs(out[it * 2]) } > 0.49f)
    assertEquals(0.25f, (0 until n).maxOf { abs(out[it * 2 + 1]) }, 0.01f)
  }

  @Test fun chunkedRenderMatchesSingleRender() {
    val d = doc(2, wav("l.wav", 2) { i, c -> if (c == 0) sine(i) else 0.0 }, wav("r.wav", 1) { i, _ -> sine(i) * 0.3 })
    val whole = render(d)
    val parts = FloatArray(n * 2)
    Mixer(d).use { m ->
      val tmpBuf = FloatArray(1000 * 2)
      var f = 0
      while (f < n) {
        val k = minOf(1000, n - f)
        m.render(f.toLong(), k, tmpBuf)
        System.arraycopy(tmpBuf, 0, parts, f * 2, k * 2)
        f += k
      }
    }
    assertArrayEquals(whole, parts, 0f)
  }
}
