import { NativeModule, requireNativeModule } from 'expo';

import { PodsnowRecorderModuleEvents } from './PodsnowRecorder.types';

declare class PodsnowRecorderModule extends NativeModule<PodsnowRecorderModuleEvents> {
  PI: number;
  hello(): string;
  setValueAsync(value: string): Promise<void>;
}

export default requireNativeModule<PodsnowRecorderModule>('PodsnowRecorder');
