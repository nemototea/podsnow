import * as Haptics from 'expo-haptics';

import type { HapticKind, HapticsPort } from '@/services/feedback/HapticsPort';

const PLAY: Record<HapticKind, () => Promise<void>> = {
  impact: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  selection: () => Haptics.selectionAsync(),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
};

/** expo-haptics を HapticsPort に適合させる。 */
export function createNativeHaptics(): HapticsPort {
  return { play: (kind) => PLAY[kind]() };
}
