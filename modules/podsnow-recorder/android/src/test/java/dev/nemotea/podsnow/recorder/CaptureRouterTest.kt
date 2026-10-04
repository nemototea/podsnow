package dev.nemotea.podsnow.recorder

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * モニター（ファイルに書かない）から録音への切り替え（AUDIO_DESIGN.md §3.6、Issue #169）。
 * 読み出しスレッドを止めずに writer を渡しても、WAV が壊れないこと。
 */
class CaptureRouterTest {
  @get:Rule val tmp = TemporaryFolder()

  private val channels = 2
  private val bufBytes = 960 * channels * 2 // 20 ms（48 kHz ステレオ）

  @Test
  fun monitorDoesNotWriteAnything() {
    val router = CaptureRouter()
    repeat(10) { assertEquals(CaptureRouter.Outcome.MONITOR, router.route(buffer(it), bufBytes)) }
    assertNull(router.writer)
    assertEquals(0, tmp.root.listFiles()!!.size)
  }

  @Test
  fun writesOnlyBuffersAfterAttach() {
    val router = CaptureRouter()
    val f = File(tmp.root, "seg-0001.wav")
    repeat(3) { router.route(buffer(it), bufBytes) }
    router.attach(WavWriter(f.path, 48000, channels, flushIntervalMs = 1000))
    for (i in 3 until 8) assertEquals(CaptureRouter.Outcome.WRITTEN, router.route(buffer(i), bufBytes))
    router.detach()!!.finalizeFile()
    assertEquals(CaptureRouter.Outcome.MONITOR, router.route(buffer(8), bufBytes))

    assertEquals(listOf(3, 4, 5, 6, 7), sequenceNumbers(f))
    assertHeaderMatchesFile(f)
  }

  @Test
  fun pausedBuffersAreDropped() {
    val router = CaptureRouter()
    val f = File(tmp.root, "seg-0001.wav")
    router.attach(WavWriter(f.path, 48000, channels, flushIntervalMs = 1000))
    router.route(buffer(0), bufBytes)
    router.paused = true
    assertEquals(CaptureRouter.Outcome.PAUSED, router.route(buffer(1), bufBytes))
    router.paused = false
    router.route(buffer(2), bufBytes)
    router.detach()!!.finalizeFile()
    assertEquals(listOf(0, 2), sequenceNumbers(f))
  }

  @Test(expected = IllegalStateException::class)
  fun attachTwiceIsRejected() {
    val router = CaptureRouter()
    router.attach(WavWriter(File(tmp.root, "a.wav").path, 48000, channels, 1000))
    router.attach(WavWriter(File(tmp.root, "b.wav").path, 48000, channels, 1000))
  }

  /**
   * 読み出しスレッドが回り続ける中で、main 側が attach → detach → finalize する。
   * RecorderEngine の stop と同じく、ループを止めてから外す順番と、止める前に外す順番の両方を確かめる。
   */
  @Test
  fun switchWhileReaderRunsKeepsWavIntact() {
    repeat(20) { round ->
      for (stopLoopFirst in listOf(true, false)) {
        val router = CaptureRouter()
        val f = File(tmp.root, "seg-$round-$stopLoopFirst.wav")
        val seq = AtomicInteger(0)
        val written = AtomicInteger(0)
        val started = CountDownLatch(50)
        val running = AtomicBoolean(true)
        val reader = Thread {
          while (running.get()) {
            val n = seq.getAndIncrement()
            if (router.route(buffer(n), bufBytes) == CaptureRouter.Outcome.WRITTEN) written.incrementAndGet()
            started.countDown()
          }
        }
        reader.start()
        assertTrue(started.await(5, TimeUnit.SECONDS))
        // ヘッダ間隔を 0 にして、追記のたびにヘッダを書き戻す（書き戻しと追記が交互に来ても壊れないこと）
        router.attach(WavWriter(f.path, 48000, channels, flushIntervalMs = 0))
        while (written.get() < 200) Thread.yield()
        val w: WavWriter
        if (stopLoopFirst) {
          running.set(false)
          reader.join(5000)
          w = router.detach()!!
        } else {
          w = router.detach()!!
          w.finalizeFile()
          running.set(false)
          reader.join(5000)
        }
        w.finalizeFile()
        assertFalse(reader.isAlive)

        val nums = sequenceNumbers(f)
        // 書いたバッファはすべて、欠けず・重ならず・連番で入っている
        assertTrue(nums.size >= 200)
        assertEquals((nums.first() until nums.first() + nums.size).toList(), nums)
        assertEquals(nums.size.toLong() * bufBytes / (channels * 2), w.frames)
        assertHeaderMatchesFile(f)
      }
    }
  }

  // ---- helpers ----

  /** 先頭 4 byte に連番、残りをその連番から作った値で埋めたバッファ。 */
  private fun buffer(n: Int): ByteArray {
    val b = ByteBuffer.allocate(bufBytes).order(ByteOrder.LITTLE_ENDIAN)
    b.putInt(n)
    while (b.hasRemaining()) b.put((n * 31 + b.position()).toByte())
    return b.array()
  }

  /** WAV の data をバッファ単位に切り、各バッファが丸ごと入っていることを確かめて連番を返す。 */
  private fun sequenceNumbers(f: File): List<Int> {
    val data = f.readBytes().copyOfRange(44, f.length().toInt())
    assertEquals("data がバッファ単位で切れている", 0, data.size % bufBytes)
    return (0 until data.size / bufBytes).map { i ->
      val chunk = data.copyOfRange(i * bufBytes, (i + 1) * bufBytes)
      val n = ByteBuffer.wrap(chunk).order(ByteOrder.LITTLE_ENDIAN).getInt(0)
      val expected = buffer(n)
      assertTrue("バッファ $i が壊れている", expected.contentEquals(chunk))
      n
    }
  }

  private fun assertHeaderMatchesFile(f: File) {
    val h = ByteBuffer.wrap(f.readBytes().copyOfRange(0, 44)).order(ByteOrder.LITTLE_ENDIAN)
    val dataBytes = f.length() - 44
    assertEquals("RIFF", String(f.readBytes().copyOfRange(0, 4), Charsets.US_ASCII))
    assertEquals(dataBytes, h.getInt(40).toLong())
    assertEquals(dataBytes + 36, h.getInt(4).toLong())
    assertEquals(0L, dataBytes % (channels * 2))
  }
}
