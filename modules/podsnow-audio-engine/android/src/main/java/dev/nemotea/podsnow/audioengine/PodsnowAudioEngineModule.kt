package dev.nemotea.podsnow.audioengine

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PodsnowAudioEngineModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PodsnowAudioEngine")

    Events("onChange")

    Constant("PI") {
      Math.PI
    }

    Function("hello") {
      "Hello world! 👋"
    }

    AsyncFunction("setValueAsync") { value: String ->
      sendEvent("onChange", mapOf(
        "value" to value
      ))
    }
  }
}
