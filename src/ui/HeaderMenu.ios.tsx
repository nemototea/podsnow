import { Stack } from 'expo-router';

import type { HeaderMenuProps } from './menuTypes';
import { SYMBOLS } from './symbols';

/**
 * iOS はナビゲーションバーのボタン（`Stack.Toolbar.Button`）と、ボタンに付くネイティブメニュー
 * （`Stack.Toolbar.Menu`）。iOS 26 ではバーのボタンと同じガラスの面になる。
 * 【確認済み】Button と Menu を同じ Toolbar に兄弟として並べられる
 * https://docs.expo.dev/versions/v57.0.0/sdk/router/stack/
 */
export function HeaderMenu({ label, title, actions, disabled, buttons }: HeaderMenuProps) {
  return (
    <Stack.Toolbar placement="right">
      {buttons?.map((b) => (
        <Stack.Toolbar.Button
          key={b.key}
          icon={SYMBOLS[b.icon]}
          accessibilityLabel={b.label}
          disabled={!!b.disabled}
          onPress={b.onPress}
        />
      ))}
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
