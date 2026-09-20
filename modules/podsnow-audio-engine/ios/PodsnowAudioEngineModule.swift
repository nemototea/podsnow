import ExpoModulesCore

struct SilenceOptionsRecord: Record {
  @Field var minDurationMs: Int = 1500
  @Field var thresholdDb: Double = -45
  @Field var windowMs: Int = 20
}

struct ImportOptionsRecord: Record {
  @Field var sampleRate: Int = 48000
  @Field var channels: Int = 1
}

struct RenderOptionsRecord: Record {
  @Field var path: String = ""
  @Field var format: String = "m4a"
  @Field var bitrate: Int = 128_000
}

public class PodsnowAudioEngineModule: Module {
  private var player: TimelinePlayer?
  private var jobs: [String: RenderJob] = [:]
  private var jobSeq = 0
  private let workQueue = DispatchQueue(label: "dev.nemotea.podsnow.audioengine.work", qos: .userInitiated, attributes: .concurrent)
  private let jobsLock = NSLock()

  private func getPlayer() -> TimelinePlayer {
    if let p = player { return p }
    let p = TimelinePlayer { [weak self] name, body in self?.sendEvent(name, body) }
    player = p
    return p
  }

  public func definition() -> ModuleDefinition {
    Name("PodsnowAudioEngine")

    Events("onRenderProgress", "onRenderDone", "onRenderError", "onPlaybackState", "onPosition", "onError", "onTaskProgress")

    OnDestroy {
      self.jobsLock.lock(); self.jobs.values.forEach { $0.cancelled = true }; self.jobsLock.unlock()
      self.player?.release()
      self.player = nil
    }

    // ---- 解析（ワーカースレッド）----
    AsyncFunction("generatePeaksAsync") { (src: String, dst: String, samplesPerSecond: Int) -> [String: Any] in
      ["count": try Peaks.generate(src: src, dst: dst, samplesPerSecond: samplesPerSecond)]
    }.runOnQueue(workQueue)

    AsyncFunction("detectSilenceAsync") { (src: String, opts: SilenceOptionsRecord) -> [[String: Any]] in
      try SilenceDetector.detect(src: src, minDurationMs: opts.minDurationMs, thresholdDb: opts.thresholdDb, windowMs: opts.windowMs)
        .map { ["start": $0.start, "end": $0.end] }
    }.runOnQueue(workQueue)

    AsyncFunction("importAssetAsync") { (src: String, dst: String, opts: ImportOptionsRecord) -> [String: Any] in
      let r = try AssetImporter.importAsset(src: src, dst: dst, sampleRate: opts.sampleRate, channels: max(1, min(2, opts.channels))) { [weak self] p in
        self?.sendEvent("onTaskProgress", ["task": "import", "path": dst, "progress": p])
      }
      return ["path": r.path, "frames": r.frames, "sampleRate": r.sampleRate, "channels": r.channels]
    }.runOnQueue(workQueue)

    AsyncFunction("readWavInfoAsync") { (path: String) -> [String: Any] in
      let r = try WavReader(path: path)
      return ["frames": r.frames, "sampleRate": r.sampleRate, "channels": r.channels]
    }.runOnQueue(workQueue)

    // ---- 再生（メインスレッド）----
    AsyncFunction("loadTimelineAsync") { (docJson: String) in
      try self.getPlayer().load(try RenderDocument.parse(json: docJson))
    }.runOnQueue(.main)

    AsyncFunction("playAsync") { (atFrame: Double?) in
      try self.getPlayer().play(at: atFrame.map { Int64($0) })
    }.runOnQueue(.main)

    AsyncFunction("pauseAsync") {
      self.getPlayer().pause()
    }.runOnQueue(.main)

    AsyncFunction("seekAsync") { (frame: Double) in
      self.getPlayer().seek(to: Int64(frame))
    }.runOnQueue(.main)

    AsyncFunction("unloadAsync") {
      self.player?.release()
      self.player = nil
    }.runOnQueue(.main)

    Function("getPosition") { () -> Double in Double(self.player?.currentFrame ?? 0) }
    Function("isPlaying") { () -> Bool in self.player?.playing ?? false }

    // ---- 書き出し（ワーカースレッド、進捗はイベント）----
    Function("startRender") { (docJson: String, opts: RenderOptionsRecord) -> String in
      let doc = try RenderDocument.parse(json: docJson)
      self.jobSeq += 1
      let id = "render-\(self.jobSeq)"
      let job = RenderJob(doc: doc, outPath: opts.path, format: opts.format, bitrate: opts.bitrate) { [weak self] p, phase in
        self?.sendEvent("onRenderProgress", ["jobId": id, "progress": p, "phase": phase])
      }
      self.jobsLock.lock(); self.jobs[id] = job; self.jobsLock.unlock()
      self.workQueue.async { [weak self] in
        defer { self?.jobsLock.lock(); self?.jobs[id] = nil; self?.jobsLock.unlock() }
        do {
          let r = try job.run()
          self?.sendEvent("onRenderDone", [
            "jobId": id, "path": r.path, "frames": r.frames,
            "measuredLufs": r.measuredLufs, "measuredTruePeakDb": r.measuredTruePeakDb, "appliedGainDb": r.appliedGainDb,
          ])
        } catch AudioEngineError.cancelled {
          self?.sendEvent("onRenderError", ["jobId": id, "message": "cancelled", "cancelled": true])
        } catch {
          self?.sendEvent("onRenderError", ["jobId": id, "message": error.localizedDescription, "cancelled": false])
        }
      }
      return id
    }

    Function("cancelRender") { (jobId: String) in
      self.jobsLock.lock(); self.jobs[jobId]?.cancelled = true; self.jobsLock.unlock()
    }
  }
}
