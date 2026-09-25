import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Icon, Row } from './components';
import type { ChoiceMenuProps } from './menuTypes';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { icon, space, typography } from './tokens';

export type { ChoiceMenuProps };

/** 値を 1 つ選ぶ行（Android と Web はシート。iOS は `ChoiceMenu.ios.tsx` のメニュー）。 */
export function ChoiceMenu<T extends string | number>({
  label,
  sub,
  title,
  value,
  options,
  onChange,
  emptyText,
  last,
}: ChoiceMenuProps<T>) {
  const c = useAppTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Row label={label} {...(sub ? { sub } : {})} last={!!last} onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={() => setOpen(false)} title={title}>
        {options.map((o, i) => (
          <Row
            key={String(o.value)}
            label={o.label}
            {...(o.sub ? { sub: o.sub } : {})}
            last={i === options.length - 1}
            right={
              o.value === value ? <Icon name="check" color={c.accentText} size={icon.sm} /> : <></>
            }
            onPress={() => {
              setOpen(false);
              onChange(o.value);
            }}
          />
        ))}
        {options.length === 0 && emptyText ? (
          <Text style={[typography.body, st.empty, { color: c.textSecondary }]}>{emptyText}</Text>
        ) : null}
      </Sheet>
    </>
  );
}

const st = StyleSheet.create({
  empty: { paddingVertical: space.md },
});
