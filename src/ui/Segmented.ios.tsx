import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import type { SegmentedProps } from './Segmented';
import { useFontFamily } from './Text';
import { useAppTheme } from './ThemeContext';
import { hit, typography } from './tokens';

export type { SegmentedProps };

/**
 * iOS は UISegmentedControl（DESIGN_SYSTEM.md §6.2）。選択の動き・触覚・読み上げは OS に任せ、
 * 書体と面の色だけを当てる。
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: SegmentedProps<T>) {
  const c = useAppTheme();
  const fontFamily = useFontFamily();
  const [nonce, setNonce] = useState(0);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <SegmentedControl
      key={nonce}
      values={options.map((o) => o.label)}
      selectedIndex={index}
      onChange={(e) => {
        const next = options[e.nativeEvent.selectedSegmentIndex];
        if (!next) return;
        onChange(next.value);
        // 選べない項目は UISegmentedControl 側の選択を元に戻す（制御値が変わらないため作り直す）。
        if (next.value !== value && disabled?.(next.value)) setNonce((n) => n + 1);
      }}
      appearance={c.isDark ? 'dark' : 'light'}
      backgroundColor={c.surface}
      tintColor={c.surfaceRaised}
      fontStyle={{
        color: c.textSecondary,
        fontSize: typography.label.fontSize,
        ...(fontFamily ? { fontFamily } : {}),
      }}
      activeFontStyle={{
        color: c.textPrimary,
        fontSize: typography.label.fontSize,
        fontWeight: typography.label.fontWeight,
        ...(fontFamily ? { fontFamily } : {}),
      }}
      style={st.control}
    />
  );
}

const st = StyleSheet.create({
  control: { height: hit.min },
});
