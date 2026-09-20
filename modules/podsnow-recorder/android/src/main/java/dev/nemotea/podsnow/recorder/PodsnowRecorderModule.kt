package dev.nemotea.podsnow.recorder

import android.Manifest
import android.os.Build
import expo.modules.interfaces.permissions.Permissions
import expo.modules.interfaces.permissions.PermissionsResponse
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class AndroidNotificationRecord : Record {
  @Field val title: String? = null
  @Field val text: String? = null
  @Field val channelName: String? = null
  @Field val channelDescription: String? = null
}

class RecorderConfigRecord : Record {
  @Field val sampleRate: Int = 48000
  @Field val channels: Int = 1
  @Field val inputUid: String? = null
  @Field val diskLowThresholdBytes: Double? = null
  @Field val headerFlushIntervalMs: Double? = null
  @Field val levelIntervalMs: Double? = null
  @Field val androidAudioSource: String? = null
  /** 通知の文言。表示言語を知っている JS 側が渡す（Issue #80）。 */
  @Field val androidNotification: AndroidNotificationRecord? = null
}

class RecorderException(message: String) : CodedException("ERR_RECORDER", message, null)

class PodsnowRecorderModule : Module() {
  private var engine: RecorderEngine? = null

  private fun getEngine(): RecorderEngine {
    engine?.let { return it }
    val ctx = appContext.reactContext ?: throw RecorderException("no react context")
    val e = RecorderEngine(ctx.applicationContext) { name, body -> sendEvent(name, body) }
    engine = e
    return e
  }

  private fun permissionNames(): Array<String> {
    val list = mutableListOf(Manifest.permission.RECORD_AUDIO)
    if (Build.VERSION.SDK_INT >= 33) list.add(Manifest.permission.POST_NOTIFICATIONS)
    return list.toTypedArray()
  }

  private fun toResult(map: Map<String, PermissionsResponse>): Map<String, String> {
    fun status(p: String): String = when (map[p]?.status) {
      PermissionsStatus.GRANTED -> "granted"
      PermissionsStatus.DENIED -> "denied"
      else -> "undetermined"
    }
    val notif = if (Build.VERSION.SDK_INT >= 33) status(Manifest.permission.POST_NOTIFICATIONS) else "granted"
    return mapOf("microphone" to status(Manifest.permission.RECORD_AUDIO), "notifications" to notif)
  }

  private fun <T> wrap(block: () -> T): T = try {
    block()
  } catch (e: CodedException) {
    throw e
  } catch (e: Exception) {
    throw RecorderException(e.message ?: e.toString())
  }

  override fun definition() = ModuleDefinition {
    Name("PodsnowRecorder")

    Events("onLevel", "onInterruption", "onRouteChange", "onSegmentClosed", "onError", "onDiskLow", "onStateChange")

    OnDestroy {
      engine?.release()
      engine = null
    }

    AsyncFunction("requestPermissionsAsync") { promise: Promise ->
      val pm: Permissions = appContext.permissions ?: throw RecorderException("permissions module unavailable")
      pm.askForPermissions({ result -> promise.resolve(toResult(result)) }, *permissionNames())
    }

    AsyncFunction("getPermissionsAsync") { promise: Promise ->
      val pm: Permissions = appContext.permissions ?: throw RecorderException("permissions module unavailable")
      pm.getPermissions({ result -> promise.resolve(toResult(result)) }, *permissionNames())
    }

    AsyncFunction("prepareAsync") { config: RecorderConfigRecord ->
      wrap {
        val base = RecorderEngine.Config()
        config.androidNotification?.let { n ->
          val d = RecorderService.Strings()
          RecorderService.strings = RecorderService.Strings(
            title = n.title ?: d.title,
            text = n.text ?: d.text,
            channelName = n.channelName ?: d.channelName,
            channelDescription = n.channelDescription ?: d.channelDescription,
          )
        }
        getEngine().prepare(
          base.copy(
            sampleRate = config.sampleRate,
            channels = config.channels.coerceIn(1, 2),
            inputUid = config.inputUid,
            diskLowThresholdBytes = config.diskLowThresholdBytes?.toLong() ?: base.diskLowThresholdBytes,
            headerFlushIntervalMs = config.headerFlushIntervalMs?.toLong()?.coerceAtLeast(100) ?: base.headerFlushIntervalMs,
            levelIntervalMs = config.levelIntervalMs?.toLong()?.coerceAtLeast(10) ?: base.levelIntervalMs,
            audioSource = config.androidAudioSource ?: base.audioSource,
          ),
        )
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("startAsync") { path: String -> wrap { getEngine().start(path) } }.runOnQueue(Queues.MAIN)
    AsyncFunction("pauseAsync") { wrap { getEngine().pause() } }.runOnQueue(Queues.MAIN)
    AsyncFunction("resumeAsync") { wrap { getEngine().resume() } }.runOnQueue(Queues.MAIN)
    AsyncFunction("stopAsync") { wrap { getEngine().stop("stop") } }.runOnQueue(Queues.MAIN)
    AsyncFunction("releaseAsync") { engine?.release() }.runOnQueue(Queues.MAIN)

    Function("getState") { engine?.state?.raw ?: "idle" }
    Function("getFrames") { (engine?.frames ?: 0L).toDouble() }

    AsyncFunction("getInputsAsync") { getEngine().availableInputs() }
    AsyncFunction("setInputAsync") { uid: String? -> wrap { getEngine().setInput(uid) } }.runOnQueue(Queues.MAIN)
    AsyncFunction("getCurrentInputAsync") { getEngine().currentInput() }
    AsyncFunction("isSpeakerOutputAsync") { getEngine().isSpeakerOutput() }

    AsyncFunction("repairWavHeaderAsync") { path: String ->
      wrap {
        val r = WavWriter.repairHeader(path)
        mapOf("path" to path, "frames" to r.frames, "bytes" to r.bytes, "sampleRate" to r.sampleRate, "channels" to r.channels)
      }
    }

    AsyncFunction("getAvailableDiskBytesAsync") { path: String -> RecorderEngine.availableBytes(path).toDouble() }
  }
}
