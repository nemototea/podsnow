import { registerWebModule, NativeModule } from 'expo';

import { PodsnowRecorderModuleEvents } from './PodsnowRecorder.types';

// PodsnowRecorderModule is not available on the web platform.
class PodsnowRecorderModule extends NativeModule<PodsnowRecorderModuleEvents> {}

export default registerWebModule(PodsnowRecorderModule, 'PodsnowRecorderModule');
