import { registerWebModule, NativeModule } from 'expo';

import { PodsnowAudioEngineModuleEvents } from './PodsnowAudioEngine.types';

// PodsnowAudioEngineModule is not available on the web platform.
class PodsnowAudioEngineModule extends NativeModule<PodsnowAudioEngineModuleEvents> {}

export default registerWebModule(PodsnowAudioEngineModule, 'PodsnowAudioEngineModule');
