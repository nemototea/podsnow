import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { font, pickerStyle, tag, tint } from '@expo/ui/swift-ui/modifiers';

import { Row } from './components';
import type { ChoiceMenuProps } from './menuTypes';
import { useFontFamily } from './Text';
import { useAppTheme } from './ThemeContext';
import { typography } from './tokens';

export type { ChoiceMenuProps };

/**
 * iOS はメニュー形式のピッカー（DESIGN_SYSTEM.md §6.2）。行の右に選択中の値と ⌃⌄ が出て、
 * 押すと選択中にチェックの付いたメニューが開く。
 */
export function ChoiceMenu<T extends string | number>({
  label,
  sub,
  value,
  options,
  onChange,
  last,
}: ChoiceMenuProps<T>) {
  const c = useAppTheme();
  const family = useFontFamily();
  const byKey = new Map(options.map((o) => [String(o.value), o.value]));
  const selected = options.find((o) => o.value === value);
  // 右のピッカーが選択中の値を出すので、同じ文言の補足は重ねない。
  const showSub = sub && sub !== selected?.label;
  return (
    <Row
      label={label}
      {...(showSub ? { sub } : {})}
      last={!!last}
      right={
        <Host matchContents colorScheme={c.isDark ? 'dark' : 'light'}>
          <Picker
            label={label}
            selection={String(value)}
            onSelectionChange={(k) => {
              const next = byKey.get(String(k));
              if (next !== undefined) onChange(next);
            }}
            modifiers={[pickerStyle('menu'), tint(c.accentText)]}
          >
            {options.map((o) => (
              <SwiftText
                key={String(o.value)}
                modifiers={[
                  tag(String(o.value)),
                  font({ ...(family ? { family } : {}), size: typography.body.fontSize }),
                ]}
              >
                {o.label}
              </SwiftText>
            ))}
          </Picker>
        </Host>
      }
    />
  );
}
