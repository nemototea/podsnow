import ExpoModulesCore

public class PodsnowRecorderModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PodsnowRecorder")

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
