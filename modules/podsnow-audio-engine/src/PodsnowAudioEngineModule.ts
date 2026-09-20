import { NativeModule, requireNativeModule } from 'expo';

import { PodsnowAudioEngineModuleEvents } from './PodsnowAudioEngine.types';

declare class PodsnowAudioEngineModule extends NativeModule<PodsnowAudioEngineModuleEvents> {
  PI: number;
  hello(): string;
  setValueAsync(value: string): Promise<void>;
}

export default requireNativeModule<PodsnowAudioEngineModule>('PodsnowAudioEngine');
