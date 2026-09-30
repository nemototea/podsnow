import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { hit, radius, space, stroke, typography } from './tokens';

export interface SegmentedProps<T extends string> {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  /** 選べない項目。押すと `onChange` は呼ばれる（呼び出し側が理由を知らせる）が、選択は動かない。 */
  disabled?: (v: T) => boolean;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: SegmentedProps<T>) {
  const c = useAppTheme();
  return (
    <View
      style={[st.segmented, { backgroundColor: c.surface, borderColor: c.controlBorder }]}
      accessibilityRole="tablist"
    >
      {options.map((o) => {
        const active = o.value === value;
        const off = !active && !!disabled?.(o.value);
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled: off }}
            style={({ pressed }) => [
              st.segment,
              {
                backgroundColor: active ? c.textPrimary : pressed ? c.surfaceHover : 'transparent',
              },
            ]}
          >
            <Text
              style={[
                typography.label,
                st.center,
                { color: active ? c.bg : off ? c.textDisabled : c.textPrimary },
              ]}
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
  center: { alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  // 丸い端の枠に、選択中だけ本文色（墨 / 紙）で塗った丸いつまみ（#190）。
  segmented: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    borderWidth: stroke.selected,
    padding: space.xs,
    gap: space.xs,
  },
  segment: {
    flex: 1,
    minHeight: hit.min,
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
  },
});
