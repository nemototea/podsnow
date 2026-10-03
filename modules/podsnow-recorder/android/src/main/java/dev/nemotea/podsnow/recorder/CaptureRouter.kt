package dev.nemotea.podsnow.recorder

/**
 * 読み出したバッファの行き先を決める（AUDIO_DESIGN.md §3.6、Issue #169）。
 *
 * - writer が無い間は入力モニターだけ（ファイルに書かない）。
 * - attach() でヘッダまで書き終えた WavWriter を渡すと、**次に読んだバッファから**書き込む。
 *   読み出しを止めずに切り替えるので、デバイスの再初期化によるギャップがない。
 * - detach() のあとに読み出しスレッドが古い writer へ append しても、finalize 済みなら WavWriter が捨てる。
 *
 * writer は main スレッドで受け渡し、読み出しスレッドが読むので @Volatile にする。
 */
class CaptureRouter {
  enum class Outcome {
    /** writer が無い。レベルだけ出す。 */
    MONITOR,

    /** 録音中の一時停止。書かず、レベルも出さない（§3.5）。 */
    PAUSED,

    /** writer に書いた。 */
    WRITTEN,
  }

  @Volatile var writer: WavWriter? = null
    private set

  @Volatile var paused = false

  /** 録音を始める。writer はヘッダを書き終えたもの（WavWriter の init で fsync 済み）を渡す。 */
  fun attach(w: WavWriter) {
    check(writer == null) { "attach: writer already attached" }
    writer = w
  }

  /** 録音をやめる。以後のバッファはモニターになる。外した writer の finalize は呼び出し側が行う。 */
  fun detach(): WavWriter? {
    val w = writer
    writer = null
    return w
  }

  /** 読み出しスレッドから呼ぶ。書き込みの例外はそのまま投げる（呼び出し側が録音を安全停止する）。 */
  fun route(buf: ByteArray, len: Int): Outcome {
    val w = writer ?: return Outcome.MONITOR
    if (paused) return Outcome.PAUSED
    w.append(buf, len)
    return Outcome.WRITTEN
  }
}
