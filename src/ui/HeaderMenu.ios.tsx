import { Stack } from 'expo-router';

import type { MoreMenuProps } from './menuTypes';
import { SYMBOLS } from './symbols';

/**
 * iOS はナビゲーションバーのボタンに付くネイティブメニュー（`Stack.Toolbar.Menu`）。
 * iOS 26 ではバーのボタンと同じガラスの面になる。
 */
export function HeaderMenu({ label, title, actions, disabled }: MoreMenuProps) {
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu
        icon="ellipsis"
        accessibilityLabel={label}
        disabled={!!disabled}
        {...(title ? { title } : {})}
      >
        {actions.map((a) => (
          <Stack.Toolbar.MenuAction
            key={a.key}
            {...(a.icon ? { icon: SYMBOLS[a.icon] } : {})}
            {...(a.sub ? { subtitle: a.sub } : {})}
            destructive={!!a.destructive}
            onPress={a.onPress}
          >
            {a.label}
          </Stack.Toolbar.MenuAction>
        ))}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}
