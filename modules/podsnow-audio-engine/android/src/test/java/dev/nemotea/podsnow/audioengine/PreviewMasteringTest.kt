package dev.nemotea.podsnow.audioengine

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/**
 * 試聴の音の仕上げ（AUDIO_DESIGN.md §7.1、Issue #158）。
 * 試聴（Mixer.enablePreview）と書き出し（LoudnessRenderer）で同じ音になることを確かめる。
 */
class PreviewMasteringTest {
  @get:Rule val tmp = TemporaryFolder()

  private val fs = TestSignals.FS
  private val seconds = 40
  private val total = seconds * fs
  /** 試聴の再生スレッドと同じブロックの大きさ（TimelinePlayer.kt）。 */
  private val block = 2048

  private lateinit var voice: File
  private lateinit var bgm: File

  private fun files() {
    if (::voice.isInitialized) return
    // ピークの立つ声（リミッターが働く）と、声の下で下げる BGM
    val v = TestSignals.speechLike(seconds, 0.9, 7)
    voice = tmp.newFile("v.wav").also { f -> TestSignals.writeWav(f, 1, total) { i, _ -> v[i] } }
    bgm = tmp.newFile("b.wav").also { f ->
      TestSignals.writeWav(f, 2, total) { i, c -> 0.2 * sin(2 * PI * (if (c == 0) 220 else 330) * i / fs) }
    }
  }

  private fun doc(
    channels: Int = 2,
    gainDb: Double? = null,
    duck: Boolean = true,
    loudness: Boolean = true,
    ceilingDb: Double = -1.0,
  ): RenderDocument {
    files()
    val g = if (gainDb == null) "" else ""","gainDb":$gainDb"""
    return RenderDocument.parse(
      """{"sampleRate":$fs,"channels":$channels,"totalFrames":$total,
        "voice":[{"path":"${voice.absolutePath}","fileStart":0,"fileEnd":$total,"tlStart":0,"gainDb":0}],
        "overlays":[{"path":"${bgm.absolutePath}","fileStart":0,"fileEnd":$total,"tlStart":0,"tlEnd":$total,"gainDb":-3,"duck":true}],
        "ducking":{"enabled":$duck,"depthDb":-12,"attackMs":50,"releaseMs":500,"thresholdDb":-40},
        "loudness":{"enabled":$loudness,"targetLufs":-16,"truePeakDbtp":$ceilingDb$g}}""",
    )
  }

  /** 書き出しの本番のパスが書くサンプル（エンコード前の Float）と、求めたゲイン。 */
  private fun export(d: RenderDocument): Pair<FloatArray, Double> = Mixer(d).use { m ->
    val r = LoudnessRenderer(d, m)
    val g = r.solveGain()
    val ch = m.channels
    val out = FloatArray(total * ch)
    var pos = 0
    r.render(g) { buf, offset, frames ->
      System.arraycopy(buf, offset * ch, out, pos * ch, frames * ch)
      pos += frames
    }
    assertEquals(total, pos)
    out to g
  }

  /**
   * 試聴: TimelinePlayer と同じく、reset してから block ずつ render する。
   * at の各要素（開始フレーム → 鳴らす長さ）ごとにシークし、before(frame) で途中の差し替えを入れる。
   */
  private fun preview(
    d: RenderDocument,
    from: Int = 0,
    until: Int = total,
    mixer: Mixer = Mixer(d).also { it.enablePreview() },
    before: (Mixer, Int) -> Unit = { _, _ -> },
  ): FloatArray {
    val ch = mixer.channels
    val out = FloatArray((until - from) * ch)
    val buf = FloatArray(block * ch)
    mixer.reset()
    var f = from
    while (f < until) {
      before(mixer, f)
      val n = minOf(block, until - f)
      mixer.render(f.toLong(), n, buf)
      System.arraycopy(buf, 0, out, (f - from) * ch, n * ch)
      f += n
    }
    return out
  }

  private fun lufs(buf: FloatArray, ch: Int, from: Int = 0, frames: Int = buf.size / ch) =
    LoudnessMeter(fs, ch).apply { process(buf, frames, from) }.integrated()

  @Test fun previewFromTheStartIsTheExportSampleForSample() {
    val (exported, gain) = export(doc())
    assertTrue("the limiter must be working in this signal", gain > 0)
    val heard = preview(doc(gainDb = gain))
    assertArrayEquals(exported, heard, 0f)
  }

  @Test fun monoPreviewMatchesMonoExport() {
    val (exported, gain) = export(doc(channels = 1))
    assertArrayEquals(exported, preview(doc(channels = 1, gainDb = gain)), 0f)
  }

  @Test fun loudnessOffOrUnmeasuredPlaysTheRawMix() {
    val raw = Mixer(doc()).use { m -> FloatArray(total * 2).also { m.render(0, total, it) } }
    assertArrayEquals(raw, preview(doc(loudness = false, gainDb = 6.0)), 0f)
    // 測り終わるまで（ゲイン未定）は調整なし
    assertArrayEquals(raw, preview(doc(gainDb = null)), 0f)
  }

  @Test fun seekingKeepsEveryTenSecondsWithinHalfALu() {
    val (exported, gain) = export(doc())
    val d = doc(gainDb = gain)
    val m = Mixer(d).also { it.enablePreview() }
    // 先頭から 10 秒区切りで、行ったり来たりしながら聴く
    for (start in listOf(20, 0, 30, 10).map { it * fs }) {
      val heard = preview(d, start, start + 10 * fs, m)
      val diff = lufs(heard, 2) - lufs(exported, 2, start, 10 * fs)
      assertTrue("window at ${start / fs}s differs by $diff LU", abs(diff) <= 0.5)
    }
  }

  @Test fun changingTheGainWhilePlayingRampsAndMatchesTheExportAtTheNewGain() {
    val (_, gain) = export(doc())
    val d = doc(gainDb = gain - 6)
    val switchAt = 5 * fs
    var switched = false
    val heard = preview(d) { m, f ->
      if (!switched && f >= switchAt) {
        m.updateSound(doc(gainDb = gain).sound)
        switched = true
      }
    }
    val (exported, _) = export(doc())
    // 差し替えて 1 秒後からは、書き出しと同じ音量
    val from = 6 * fs
    val diff = lufs(heard, 2, from, total - from) - lufs(exported, 2, from, total - from)
    assertTrue("after the change: $diff LU", abs(diff) <= 0.5)
  }

  @Test fun gainChangesRampOverFiftyMilliseconds() {
    // 天井を高くしてリミッターを働かせない: 試聴の音 = ミックス × ゲイン
    val raw = Mixer(doc()).use { m -> FloatArray(total * 2).also { m.render(0, total, it) } }
    val switchAt = 5 * fs
    val heard = preview(doc(gainDb = 0.0, ceilingDb = 40.0)) { m, f ->
      if (f == (switchAt / block) * block) m.updateSound(doc(gainDb = 6.0, ceilingDb = 40.0).sound)
    }
    val at = (switchAt / block) * block
    /** フレーム i あたりのゲイン（ミックスとの比。声の大きいサンプルで測る）。 */
    fun gainAround(i: Int): Double {
      val k = (i until i + 200).maxBy { abs(raw[it * 2]) }
      return (heard[k * 2] / raw[k * 2]).toDouble()
    }
    val target = Math.pow(10.0, 6.0 / 20)
    assertEquals(1.0, gainAround(at - 400), 0.001)
    // 新しいゲインは先読みの分（リミッターの遅れ、約 250 フレーム）あとの音から効き始める。
    // その直後はまだ元のゲインに近く、50 ms（2400 フレーム）で目標に着く
    val lat = Limiter(fs, -1.0, 2).latency
    assertEquals(1.0, gainAround(at + lat - 200 - 1), 0.001)
    assertTrue("jumped: ${gainAround(at + lat + 50)}", gainAround(at + lat + 50) < 1.0 + (target - 1) * 0.2)
    assertEquals(target, gainAround(at + 2600), 0.001)
  }

  @Test fun duckingCanBeChangedWithoutReloading() {
    val (_, gain) = export(doc(duck = false))
    val heard = preview(doc(gainDb = gain)) { m, f ->
      if (f == 0) m.updateSound(doc(gainDb = gain, duck = false).sound)
    }
    val (exported, _) = export(doc(duck = false))
    assertArrayEquals(exported, heard, 0f)
  }

  @Test fun measureJobGivesTheExportGainAndAProvisionalOneFirst() {
    val (_, gain) = export(doc())
    var provisional: Double? = null
    val progress = ArrayList<Double>()
    val r = LoudnessMeasureJob(doc()) { p, g -> progress += p; if (g != null) provisional = g }.run()
    assertEquals(gain, r.gainDb, 0.0)
    assertNotNull(provisional)
    // リミッターが働く信号なので、仮のゲインは確定より大きい（削れた分を取り戻す前）
    assertTrue(r.trials > 0)
    assertTrue(progress.all { it in 0.0..1.0 })
    assertTrue(progress.zipWithNext().all { (a, b) -> b >= a })
  }

  @Test fun measureJobCanBeCancelled() {
    val job = LoudnessMeasureJob(doc()) { _, _ -> }
    job.cancelled = true
    try {
      job.run()
      throw AssertionError("expected cancellation")
    } catch (_: InterruptedException) {
    }
  }
}
