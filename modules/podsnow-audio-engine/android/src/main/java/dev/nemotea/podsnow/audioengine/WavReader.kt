package dev.nemotea.podsnow.audioengine

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** 16 bit PCM WAV の読み出し。fmt / data チャンクを探し、任意フレームからの読み出しに対応する。 */
class WavReader(val path: String) : AutoCloseable {
  val sampleRate: Int
  val channels: Int
  val bitsPerSample: Int
  val frames: Long
  private val dataOffset: Long
  private val file = RandomAccessFile(File(path), "r")

  init {
    val head = ByteArray(12)
    file.readFully(head)
    require(String(head, 0, 4, Charsets.US_ASCII) == "RIFF" && String(head, 8, 4, Charsets.US_ASCII) == "WAVE") { "not a WAV: $path" }
    var sr = 0; var ch = 0; var bits = 0
    var dOff = -1L; var dLen = 0L
    var pos = 12L
    val len = file.length()
    while (pos + 8 <= len) {
      file.seek(pos)
      val ck = ByteArray(8); file.readFully(ck)
      val id = String(ck, 0, 4, Charsets.US_ASCII)
      val size = ByteBuffer.wrap(ck, 4, 4).order(ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xFFFFFFFFL
      if (id == "fmt ") {
        val f = ByteArray(16); file.readFully(f)
        val bb = ByteBuffer.wrap(f).order(ByteOrder.LITTLE_ENDIAN)
        val fmt = bb.getShort(0).toInt()
        require(fmt == 1 || fmt == 0xFFFE) { "unsupported WAV format $fmt" }
        ch = bb.getShort(2).toInt(); sr = bb.getInt(4); bits = bb.getShort(14).toInt()
      } else if (id == "data") {
        dOff = pos + 8
        // 未確定ヘッダ (0xFFFFFFFF) や過大なサイズは実長で切り詰める
        dLen = if (size == 0xFFFFFFFFL || pos + 8 + size > len) len - (pos + 8) else size
        break
      }
      pos += 8 + size + (size and 1L)
    }
    require(dOff >= 0 && ch > 0 && sr > 0) { "WAV without fmt/data: $path" }
    require(bits == 16) { "only 16 bit PCM is supported: $path" }
    sampleRate = sr; channels = ch; bitsPerSample = bits; dataOffset = dOff
    frames = dLen / (ch * 2)
  }

  /**
   * [frame, frame+count) を Float32 モノラルにダウンミックスして out に書く（不足分は 0）。
   * 戻り値: 実際に読めたフレーム数。
   */
  fun readMono(frame: Long, count: Int, out: FloatArray, outOffset: Int = 0): Int {
    if (frame >= frames || count <= 0) { java.util.Arrays.fill(out, outOffset, outOffset + count, 0f); return 0 }
    val n = minOf(count.toLong(), frames - frame).toInt()
    val bytes = ByteArray(n * channels * 2)
    file.seek(dataOffset + frame * channels * 2)
    file.readFully(bytes)
    val bb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    val inv = 1f / (32768f * channels)
    for (i in 0 until n) {
      var acc = 0
      for (c in 0 until channels) acc += bb.getShort((i * channels + c) * 2).toInt()
      out[outOffset + i] = acc * inv
    }
    java.util.Arrays.fill(out, outOffset + n, outOffset + count, 0f)
    return n
  }

  /** インターリーブ Float32（チャンネル数はファイルのまま）。 */
  fun readInterleaved(frame: Long, count: Int, out: FloatArray): Int {
    val total = count * channels
    if (frame >= frames || count <= 0) { java.util.Arrays.fill(out, 0, total, 0f); return 0 }
    val n = minOf(count.toLong(), frames - frame).toInt()
    val bytes = ByteArray(n * channels * 2)
    file.seek(dataOffset + frame * channels * 2)
    file.readFully(bytes)
    val bb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    for (i in 0 until n * channels) out[i] = bb.getShort(i * 2) / 32768f
    java.util.Arrays.fill(out, n * channels, total, 0f)
    return n
  }

  override fun close() = file.close()
}
