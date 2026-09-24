import { Button, Host, Image, Menu, Section } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  disabled as disabledModifier,
  frame,
} from '@expo/ui/swift-ui/modifiers';

import type { MoreMenuProps } from './menuTypes';
import { SYMBOLS } from './symbols';
import { useAppTheme } from './ThemeContext';
import { hit, icon } from './tokens';

export type { MoreMenuProps };

/**
 * iOS はネイティブのプルダウンメニュー（DESIGN_SYSTEM.md §6.2）。項目の補足は出さない
 * （iOS のメニューは 1 行の動詞で並べる）。
 */
export function MoreMenu({ label, title, actions, disabled }: MoreMenuProps) {
  const c = useAppTheme();
  const items = actions.map((a) => (
    <Button
      key={a.key}
      label={a.label}
      {...(a.icon ? { systemImage: SYMBOLS[a.icon] } : {})}
      role={a.destructive ? 'destructive' : 'default'}
      onPress={a.onPress}
    />
  ));
  return (
    <Host matchContents colorScheme={c.isDark ? 'dark' : 'light'}>
      <Menu
        label={
          <Image
            systemName="ellipsis"
            size={icon.md}
            color={disabled ? c.textDisabled : c.textPrimary}
            modifiers={[frame({ width: hit.min, height: hit.min })]}
          />
        }
        modifiers={[accessibilityLabel(label), disabledModifier(!!disabled)]}
      >
        {title ? <Section title={title}>{items}</Section> : items}
      </Menu>
    </Host>
  );
}
