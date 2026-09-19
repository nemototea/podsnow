import ExpoModulesCore

public class PodsnowAudioEngineModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PodsnowAudioEngine")

    Events("onChange")

    Constant("PI") {
      Double.pi
    }

    Function("hello") {
      return "Hello world! 👋"
    }

    AsyncFunction("setValueAsync") { (value: String) in
      self.sendEvent("onChange", [
        "value": value
      ])
    }
  }
}
