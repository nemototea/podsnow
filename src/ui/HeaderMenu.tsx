import { Stack } from 'expo-router';

import type { MoreMenuProps } from './menuTypes';
import { MoreMenu } from './MoreMenu';

/** ナビゲーションバー右の「…」（Android と Web）。iOS は `HeaderMenu.ios.tsx`。 */
export function HeaderMenu(props: MoreMenuProps) {
  return <Stack.Screen options={{ headerRight: () => <MoreMenu {...props} /> }} />;
}
