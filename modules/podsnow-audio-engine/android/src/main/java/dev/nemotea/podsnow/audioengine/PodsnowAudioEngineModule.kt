package dev.nemotea.podsnow.audioengine

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
}

class AudioEngineException(message: String) : CodedException("ERR_AUDIO_ENGINE", message, null)

class PodsnowAudioEngineModule : Module() {
  private val executor = Executors.newFixedThreadPool(2)
  private val jobs = ConcurrentHashMap<String, RenderJob>()
  private var player: TimelinePlayer? = null
  private var jobSeq = 0

  private fun getPlayer(): TimelinePlayer = player ?: TimelinePlayer { n, b -> sendEvent(n, b) }.also { player = it }

  private fun <T> wrap(block: () -> T): T = try {
    block()
  } catch (e: CodedException) {
    throw e
  } catch (e: Exception) {
    throw AudioEngineException(e.message ?: e.toString())
  }

  override fun definition() = ModuleDefinition {
    Name("PodsnowAudioEngine")

    Events("onRenderProgress", "onRenderDone", "onRenderError", "onPlaybackState", "onPosition", "onError", "onTaskProgress")

    OnDestroy {
      jobs.values.forEach { it.cancelled = true }
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
    AsyncFunction("playAsync") { atFrame: Double? -> wrap { getPlayer().play(atFrame?.toLong()) } }.runOnQueue(Queues.MAIN)
    AsyncFunction("pauseAsync") { wrap { getPlayer().pause() } }.runOnQueue(Queues.MAIN)
    AsyncFunction("seekAsync") { frame: Double -> wrap { getPlayer().seek(frame.toLong()) } }.runOnQueue(Queues.MAIN)
    AsyncFunction("unloadAsync") { player?.release(); player = null }.runOnQueue(Queues.MAIN)
    Function("getPosition") { (player?.currentFrame ?: 0L).toDouble() }
    Function("isPlaying") { player?.isPlaying ?: false }

    // ---- 書き出し（ワーカースレッド、進捗はイベント）----
    Function("startRender") { docJson: String, opts: RenderOptions ->
      val id = "render-${++jobSeq}"
      val doc = try { RenderDocument.parse(docJson) } catch (e: Exception) { throw AudioEngineException("invalid document: ${e.message}") }
      val job = RenderJob(doc, opts.path, opts.format, opts.bitrate) { p, phase ->
        sendEvent("onRenderProgress", mapOf("jobId" to id, "progress" to p, "phase" to phase))
      }
      jobs[id] = job
      executor.execute {
        try {
          val r = job.run()
          sendEvent("onRenderDone", mapOf(
            "jobId" to id, "path" to r.path, "frames" to r.frames,
            "measuredLufs" to r.measuredLufs, "measuredTruePeakDb" to r.measuredTruePeakDb, "appliedGainDb" to r.appliedGainDb,
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
  }
}
