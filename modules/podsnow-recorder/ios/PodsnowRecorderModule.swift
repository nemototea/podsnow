import AVFoundation
import ExpoModulesCore

struct RecorderConfigRecord: Record {
  @Field var sampleRate: Double = 48000
  @Field var channels: Int = 1
  @Field var inputUid: String? = nil
  @Field var diskLowThresholdBytes: Double? = nil
  @Field var headerFlushIntervalMs: Double? = nil
  @Field var levelIntervalMs: Double? = nil
}

public class PodsnowRecorderModule: Module {
  private var engine: RecorderEngine?

  private func getEngine() -> RecorderEngine {
    if let e = engine { return e }
    let e = RecorderEngine { [weak self] name, body in
      self?.sendEvent(name, body)
    }
    engine = e
    return e
  }

  public func definition() -> ModuleDefinition {
    Name("PodsnowRecorder")

    Events("onLevel", "onInterruption", "onRouteChange", "onSegmentClosed", "onError", "onDiskLow", "onStateChange")

    OnDestroy {
      self.engine?.release()
      self.engine = nil
    }

    AsyncFunction("requestPermissionsAsync") { (promise: Promise) in
      AVAudioSession.sharedInstance().requestRecordPermission { granted in
        promise.resolve(["microphone": granted ? "granted" : "denied", "notifications": "granted"])
      }
    }

    AsyncFunction("getPermissionsAsync") { () -> [String: String] in
      let status: String
      switch AVAudioSession.sharedInstance().recordPermission {
      case .granted: status = "granted"
      case .denied: status = "denied"
      default: status = "undetermined"
      }
      return ["microphone": status, "notifications": "granted"]
    }

    AsyncFunction("prepareAsync") { (config: RecorderConfigRecord) in
      var c = RecorderEngine.Config()
      c.sampleRate = config.sampleRate
      c.channels = max(1, min(2, config.channels))
      c.inputUid = config.inputUid
      if let d = config.diskLowThresholdBytes { c.diskLowThresholdBytes = UInt64(max(0, d)) }
      if let h = config.headerFlushIntervalMs { c.headerFlushInterval = max(0.1, h / 1000) }
      if let l = config.levelIntervalMs { c.levelInterval = max(0.01, l / 1000) }
      try self.getEngine().prepare(c)
    }.runOnQueue(.main)

    AsyncFunction("startAsync") { (path: String) in
      try self.getEngine().start(path: path)
    }.runOnQueue(.main)

    AsyncFunction("pauseAsync") {
      try self.getEngine().pause()
    }.runOnQueue(.main)

    AsyncFunction("resumeAsync") {
      try self.getEngine().resume()
    }.runOnQueue(.main)

    AsyncFunction("stopAsync") { () -> [String: Any] in
      try self.getEngine().stop(reason: "stop")
    }.runOnQueue(.main)

    AsyncFunction("releaseAsync") {
      self.engine?.release()
    }.runOnQueue(.main)

    Function("getState") { () -> String in
      self.engine?.state.rawValue ?? "idle"
    }

    Function("getFrames") { () -> Double in
      Double(self.engine?.frames ?? 0)
    }

    AsyncFunction("getInputsAsync") { () -> [[String: Any]] in
      RecorderEngine.availableInputs()
    }

    AsyncFunction("setInputAsync") { (uid: String?) in
      try self.getEngine().setInput(uid: uid)
    }.runOnQueue(.main)

    AsyncFunction("getCurrentInputAsync") { () -> [String: Any]? in
      RecorderEngine.currentInput()
    }

    AsyncFunction("isSpeakerOutputAsync") { () -> Bool in
      RecorderEngine.isSpeakerOutput()
    }

    AsyncFunction("repairWavHeaderAsync") { (path: String) -> [String: Any] in
      let r = try WavWriter.repairHeader(path: path)
      return ["path": path, "frames": r.frames, "bytes": r.bytes, "sampleRate": r.sampleRate, "channels": r.channels]
    }

    AsyncFunction("getAvailableDiskBytesAsync") { (path: String) -> Double in
      Double(RecorderEngine.availableBytes(forPath: path) ?? 0)
    }
  }
}
