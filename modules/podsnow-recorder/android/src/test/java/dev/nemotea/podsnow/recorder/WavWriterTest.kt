package dev.nemotea.podsnow.recorder

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** WavWriter のヘッダと復旧（AUDIO_DESIGN.md §3.3）。 */
class WavWriterTest {
  @get:Rule val tmp = TemporaryFolder()

  @Test
  fun headerIsPlaceholderUntilFlushed() {
    val f = File(tmp.root, "seg.wav")
    val w = WavWriter(f.path, 48000, 2, flushIntervalMs = 60_000)
    w.append(ByteArray(400), 400)
    val h = readHeader(f)
    assertEquals(-1, h.getInt(4)) // RIFF size 未確定
    assertEquals(-1, h.getInt(40)) // data size 未確定
    assertEquals(44L + 400, f.length())
    w.finalizeFile()
  }

  @Test
  fun finalizeWritesSizesAndFormat() {
    val f = File(tmp.root, "seg.wav")
    val w = WavWriter(f.path, 48000, 2, flushIntervalMs = 60_000)
    val pcm = ByteArray(4800) { (it % 251).toByte() }
    w.append(pcm, pcm.size)
    w.finalizeFile()
    val h = readHeader(f)
    assertEquals(4800 + 36, h.getInt(4))
    assertEquals(2, h.getShort(22).toInt())
    assertEquals(48000, h.getInt(24))
    assertEquals(48000 * 2 * 2, h.getInt(28))
    assertEquals(4, h.getShort(32).toInt())
    assertEquals(16, h.getShort(34).toInt())
    assertEquals(4800, h.getInt(40))
    assertEquals(1200L, w.frames)
    assertArrayEquals(pcm, f.readBytes().copyOfRange(44, 44 + 4800))
  }

  @Test
  fun appendAfterFinalizeIsIgnored() {
    val f = File(tmp.root, "seg.wav")
    val w = WavWriter(f.path, 48000, 1, flushIntervalMs = 60_000)
    w.append(ByteArray(10), 10)
    w.finalizeFile()
    w.append(ByteArray(10), 10)
    assertEquals(54L, f.length())
    assertEquals(10L, w.dataBytes)
  }

  @Test
  fun repairHeaderDropsPartialFrame() {
    val f = File(tmp.root, "seg.wav")
    val w = WavWriter(f.path, 48000, 2, flushIntervalMs = 60_000)
    // ステレオ 16 bit は 1 フレーム 4 byte。最後のフレームを途中で切る
    w.append(ByteArray(4 * 100 + 3), 4 * 100 + 3)
    // finalize せずに放置（クラッシュ）
    val r = WavWriter.repairHeader(f.path)
    assertEquals(100L, r.frames)
    assertEquals(44L + 400, r.bytes)
    assertEquals(44L + 400, f.length())
    assertEquals(400, readHeader(f).getInt(40))
  }

  private fun readHeader(f: File): ByteBuffer =
    ByteBuffer.wrap(f.readBytes().copyOfRange(0, 44)).order(ByteOrder.LITTLE_ENDIAN)
}
