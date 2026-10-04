package dev.nemotea.podsnow.audioengine

import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

class SilenceOptions : Record {
  @Field val minDurationMs: Int = 1500
  @Field val thresholdDb: Double = -45.0
  @Field val windowMs: Int = 20
}

class ImportOptions : Record {
  @Field val sampleRate: Int = 48000
  @Field val channels: Int = 1
}

class RenderOptions : Record {
  @Field val path: String = ""
  @Field val format: String = "m4a"
  @Field val bitrate: Int = 128000
  /** 出力のサンプルレート。0 なら RenderDocument と同じ（変換しない）。 */
  @Field val sampleRate: Int = 0
}

class NowPlayingLabelsRecord : Record {
  @Field val play: String = ""
  @Field val pause: String = ""
  @Field val rewind: String = ""
  @Field val forward: String = ""
  @Field val stop: String = ""
  @Field val channelName: String = ""
  @Field val channelDescription: String = ""
}

class NowPlayingInfoRecord : Record {
  @Field val title: String = ""
  @Field val artist: String = ""
  @Field val artworkPath: String? = null
  @Field val durationSec: Double = 0.0
  @Field val positionSec: Double = 0.0
  @Field val playing: Boolean = false
  @Field val labels: NowPlayingLabelsRecord = NowPlayingLabelsRecord()
}

class AudioEngineException(message: String) : CodedException("ERR_AUDIO_ENGINE", message, null)

class PodsnowAudioEngineModule : Module() {
  private val executor = Executors.newFixedThreadPool(2)
  private val jobs = ConcurrentHashMap<String, RenderJob>()
  private val measures = ConcurrentHashMap<String, LoudnessMeasureJob>()
  private var player: TimelinePlayer? = null
  private var jobSeq = 0
  /** タイムライン再生の音声フォーカスと、割り込み・出力の抜去（AUDIO_DESIGN.md §10.2 / §10.3）。 */
  private var watcher: PlaybackSessionWatcher? = null
  private val main = Handler(Looper.getMainLooper())

  private fun getPlayer(): TimelinePlayer = player ?: TimelinePlayer { n, b ->
    sendEvent(n, b)
    // 鳴り終わったらフォーカスを手放す（再生スレッドから来るのでメインへ移す）
    if (n == "onPlaybackState" && b["ended"] == true) main.post { watcher?.abandonFocusUnlessInterrupted() }
  }.also { player = it }

  private fun <T> wrap(block: () -> T): T = try {
    block()
  } catch (e: CodedException) {
    throw e
  } catch (e: Exception) {
    throw AudioEngineException(e.message ?: e.toString())
  }

  override fun definition() = ModuleDefinition {
    Name("PodsnowAudioEngine")

    Events("onRenderProgress", "onRenderDone", "onRenderError", "onMeasureProgress", "onMeasureDone", "onMeasureError", "onPlaybackState", "onPosition", "onError", "onTaskProgress", "onPlaybackInterruption", "onOutputDisconnected", "onRemoteCommand")

    OnCreate {
      val ctx = appContext.reactContext?.applicationContext ?: return@OnCreate
      watcher = PlaybackSessionWatcher(ctx, { n, b -> sendEvent(n, b) }, { player?.pause() }).also { it.start() }
      // ロック画面・通知の操作は鳴らす側を触らず JS へ送る（AUDIO_DESIGN.md §10.5）
      NowPlayingService.onCommand = { command, positionSec ->
        sendEvent("onRemoteCommand", mapOf("command" to command, "positionSec" to positionSec))
      }
    }

    OnDestroy {
      watcher?.stop(); watcher = null
      NowPlayingService.onCommand = null
      NowPlayingService.clear()
      jobs.values.forEach { it.cancelled = true }
      measures.values.forEach { it.cancelled = true }
      player?.release(); player = null
      executor.shutdownNow()
    }

    // ---- 解析（ワーカースレッド）----
    AsyncFunction("generatePeaksAsync") { src: String, dst: String, samplesPerSecond: Int ->
      wrap { mapOf("count" to Peaks.generate(src, dst, samplesPerSecond)) }
    }

    AsyncFunction("detectSilenceAsync") { src: String, opts: SilenceOptions ->
      wrap { SilenceDetector.detect(src, opts.minDurationMs, opts.thresholdDb, opts.windowMs).map { mapOf("start" to it.start, "end" to it.end) } }
    }

    AsyncFunction("importAssetAsync") { src: String, dst: String, opts: ImportOptions ->
      wrap {
        val r = AssetImporter.import(src, dst, opts.sampleRate, opts.channels) { p -> sendEvent("onTaskProgress", mapOf("task" to "import", "path" to dst, "progress" to p)) }
        mapOf("path" to r.path, "frames" to r.frames, "sampleRate" to r.sampleRate, "channels" to r.channels)
      }
    }

    AsyncFunction("readWavInfoAsync") { path: String ->
      wrap { WavReader(path).use { mapOf("frames" to it.frames, "sampleRate" to it.sampleRate, "channels" to it.channels) } }
    }

    // ---- 再生（メインスレッド）----
    AsyncFunction("loadTimelineAsync") { docJson: String -> wrap { getPlayer().load(RenderDocument.parse(docJson)) } }.runOnQueue(Queues.MAIN)
    AsyncFunction("playAsync") { atFrame: Double? ->
      wrap {
        val p = getPlayer()
        // 通話中などでフォーカスが取れなければ鳴らさない
        if (watcher?.requestFocus() == false) return@wrap
        try {
          p.play(atFrame?.toLong())
        } catch (e: Exception) {
          watcher?.abandonFocusUnlessInterrupted()
          throw e
        }
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("pauseAsync") { wrap { getPlayer().pause(); watcher?.abandonFocusUnlessInterrupted() } }.runOnQueue(Queues.MAIN)
    AsyncFunction("updateTimelineSoundAsync") { json: String ->
      wrap { player?.updateSound(TimelineSound.parse(json)) }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("seekAsync") { frame: Double -> wrap { getPlayer().seek(frame.toLong()) } }.runOnQueue(Queues.MAIN)
    AsyncFunction("unloadAsync") { player?.release(); player = null; watcher?.abandonFocus() }.runOnQueue(Queues.MAIN)
    Function("getPosition") { (player?.currentFrame ?: 0L).toDouble() }
    Function("isPlaying") { player?.isPlaying ?: false }

    // ---- ロック画面・通知（メインスレッド）----
    AsyncFunction("setNowPlayingAsync") { info: NowPlayingInfoRecord ->
      val ctx = appContext.reactContext?.applicationContext ?: return@AsyncFunction
      val l = info.labels
      NowPlayingService.update(
        ctx,
        NowPlayingService.Info(
          title = info.title,
          artist = info.artist,
          artworkPath = info.artworkPath,
          durationSec = info.durationSec,
          positionSec = info.positionSec,
          playing = info.playing,
          labels = NowPlayingService.Labels(l.play, l.pause, l.rewind, l.forward, l.stop, l.channelName, l.channelDescription),
        ),
      )
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("clearNowPlayingAsync") { NowPlayingService.clear() }.runOnQueue(Queues.MAIN)

    // ---- 書き出し（ワーカースレッド、進捗はイベント）----
    Function("startRender") { docJson: String, opts: RenderOptions ->
      val id = "render-${++jobSeq}"
      val doc = try { RenderDocument.parse(docJson) } catch (e: Exception) { throw AudioEngineException("invalid document: ${e.message}") }
      val outputSampleRate = if (opts.sampleRate > 0) opts.sampleRate else doc.sampleRate
      val job = RenderJob(doc, opts.path, opts.format, opts.bitrate, outputSampleRate) { p, phase ->
        sendEvent("onRenderProgress", mapOf("jobId" to id, "progress" to p, "phase" to phase))
      }
      jobs[id] = job
      executor.execute {
        try {
          val r = job.run()
          sendEvent("onRenderDone", mapOf(
            "jobId" to id, "path" to r.path, "frames" to r.frames,
            "measuredLufs" to r.measuredLufs, "measuredTruePeakDb" to r.measuredTruePeakDb, "appliedGainDb" to r.appliedGainDb,
            "inputLufs" to r.inputLufs,
          ))
        } catch (e: InterruptedException) {
          sendEvent("onRenderError", mapOf("jobId" to id, "message" to "cancelled", "cancelled" to true))
        } catch (e: Exception) {
          sendEvent("onRenderError", mapOf("jobId" to id, "message" to (e.message ?: e.toString()), "cancelled" to false))
        } finally {
          jobs.remove(id)
        }
      }
      id
    }

    Function("cancelRender") { jobId: String -> jobs[jobId]?.cancelled = true }

    // ---- ラウドネスの測定（試聴のゲイン、AUDIO_DESIGN.md §7.1 / §8.4。低い優先度のワーカー）----
    Function("measureLoudness") { docJson: String ->
      val id = "measure-${++jobSeq}"
      val doc = try { RenderDocument.parse(docJson) } catch (e: Exception) { throw AudioEngineException("invalid document: ${e.message}") }
      val job = LoudnessMeasureJob(doc) { p, provisional ->
        sendEvent("onMeasureProgress", mapOf("jobId" to id, "progress" to p, "gainDb" to provisional))
      }
      measures[id] = job
      executor.execute {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND)
        try {
          val r = job.run()
          sendEvent("onMeasureDone", mapOf(
            "jobId" to id, "gainDb" to r.gainDb, "inputLufs" to r.inputLufs,
            "inputTruePeakDb" to r.inputTruePeakDb, "trials" to r.trials, "algo" to LoudnessRenderer.ALGO_VERSION,
          ))
        } catch (e: InterruptedException) {
          sendEvent("onMeasureError", mapOf("jobId" to id, "message" to "cancelled", "cancelled" to true))
        } catch (e: Exception) {
          sendEvent("onMeasureError", mapOf("jobId" to id, "message" to (e.message ?: e.toString()), "cancelled" to false))
        } finally {
          measures.remove(id)
          android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_DEFAULT)
        }
      }
      id
    }

    Function("cancelMeasure") { jobId: String -> measures[jobId]?.cancelled = true }
  }
}
