import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { chip, hitSlop, radius, space, typography } from './tokens';

export interface SegmentedProps<T extends string> {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  /** 選べない項目。押すと `onChange` は呼ばれる（呼び出し側が理由を知らせる）が、選択は動かない。 */
  disabled?: (v: T) => boolean;
}

/**
 * 切り替え（見本 `.seg`、エピソードの「収録 / 書き出し」）。チップを左から並べ、選んでいるものだけ
 * アクセントの塗りに黒の文字。iOS も同じ形にする（#235 で UISegmentedControl をやめた。DESIGN_SYSTEM.md §6.1）。
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: SegmentedProps<T>) {
  const c = useAppTheme();
  return (
    <View style={st.row} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        const off = !active && !!disabled?.(o.value);
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled: off }}
            // 省略しても全文を読む（Issue #261）
            accessibilityLabel={o.label}
            hitSlop={hitSlop(typography.chip.lineHeight + 2 * chip.paddingY)}
            style={({ pressed }) => [
              st.chip,
              {
                backgroundColor: active
                  ? c.accentSolid
                  : pressed
                    ? c.surfaceHover
                    : c.surfaceRaised,
              },
            ]}
          >
            <Text
              style={[
                typography.chip,
                { color: active ? c.accentOnSolid : off ? c.textDisabled : c.textPrimary },
              ]}
              // 英語表示などで長くなっても折り返さず 1 行で省略する（Issue #261）
              numberOfLines={1}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingVertical: chip.paddingY,
    paddingHorizontal: chip.paddingX,
    borderRadius: radius.pill,
    maxWidth: '100%',
    flexShrink: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
