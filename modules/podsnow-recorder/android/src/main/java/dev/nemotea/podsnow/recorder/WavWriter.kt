package dev.nemotea.podsnow.recorder

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * 16 bit PCM WAV の追記書き込み。一定間隔でヘッダを書き戻して fsync する（AUDIO_DESIGN.md §3.3）。
 * 未確定ヘッダは data size = 0xFFFFFFFF。復旧は repairHeader がファイル実長から行う。
 */
class WavWriter(
  val path: String,
  val sampleRate: Int,
  val channels: Int,
  private val flushIntervalMs: Long,
) {
  companion object {
    const val HEADER_SIZE = 44L
    private const val PLACEHOLDER = -1 // 0xFFFFFFFF

    fun header(sampleRate: Int, channels: Int, dataBytes: Long?): ByteArray {
      val bits = 16
      val byteRate = sampleRate * channels * bits / 8
      val blockAlign = (channels * bits / 8).toShort()
      val dataSize = dataBytes?.let { minOf(it, 0xFFFFFFFFL - 36).toInt() } ?: PLACEHOLDER
      val riffSize = if (dataBytes == null) PLACEHOLDER else dataSize + 36
      val b = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
      b.put("RIFF".toByteArray(Charsets.US_ASCII))
      b.putInt(riffSize)
      b.put("WAVE".toByteArray(Charsets.US_ASCII))
      b.put("fmt ".toByteArray(Charsets.US_ASCII))
      b.putInt(16)
      b.putShort(1)
      b.putShort(channels.toShort())
      b.putInt(sampleRate)
      b.putInt(byteRate)
      b.putShort(blockAlign)
      b.putShort(bits.toShort())
      b.put("data".toByteArray(Charsets.US_ASCII))
      b.putInt(dataSize)
      return b.array()
    }

    data class Repaired(val frames: Long, val bytes: Long, val sampleRate: Int, val channels: Int)

    /** ヘッダ未確定の WAV をファイル実長から修復する。 */
    fun repairHeader(path: String): Repaired {
      RandomAccessFile(File(path), "rw").use { f ->
        val size = f.length()
        require(size >= HEADER_SIZE) { "file too short: $path" }
        val head = ByteArray(HEADER_SIZE.toInt())
        f.seek(0)
        f.readFully(head)
        val bb = ByteBuffer.wrap(head).order(ByteOrder.LITTLE_ENDIAN)
        val channels = bb.getShort(22).toInt()
        val sampleRate = bb.getInt(24)
        val blockAlign = maxOf(1, channels * 2).toLong()
        var dataBytes = size - HEADER_SIZE
        dataBytes -= dataBytes % blockAlign
        f.seek(0)
        f.write(header(sampleRate, channels, dataBytes))
        f.setLength(HEADER_SIZE + dataBytes)
        f.fd.sync()
        return Repaired(dataBytes / blockAlign, HEADER_SIZE + dataBytes, sampleRate, channels)
      }
    }
  }

  private val file: RandomAccessFile
  var dataBytes: Long = 0
    private set
  private var lastFlush = System.currentTimeMillis()
  private var closed = false

  val frames: Long get() = dataBytes / (channels * 2)
  val fileBytes: Long get() = HEADER_SIZE + dataBytes

  init {
    File(path).parentFile?.mkdirs()
    file = RandomAccessFile(File(path), "rw")
    file.setLength(0)
    file.write(header(sampleRate, channels, null))
    file.fd.sync()
  }

  @Synchronized
  fun append(buf: ByteArray, len: Int) {
    if (closed) return
    file.seek(HEADER_SIZE + dataBytes)
    file.write(buf, 0, len)
    dataBytes += len
    val now = System.currentTimeMillis()
    if (now - lastFlush >= flushIntervalMs) flushHeader()
  }

  @Synchronized
  fun flushHeader() {
    if (closed) return
    file.seek(0)
    file.write(header(sampleRate, channels, dataBytes))
    file.fd.sync()
    lastFlush = System.currentTimeMillis()
  }

  @Synchronized
  fun finalizeFile() {
    if (closed) return
    flushHeader()
    file.close()
    closed = true
  }
}
