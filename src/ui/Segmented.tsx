import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { concentric, hit, radius, space, stroke, typography } from './tokens';

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
      style={[st.segmented, { backgroundColor: c.surface, borderColor: c.border }]}
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
                backgroundColor: active
                  ? c.surfaceHover
                  : pressed
                    ? c.surfaceRaised
                    : 'transparent',
                borderColor: active ? c.borderStrong : 'transparent',
              },
            ]}
          >
            <Text
              style={[
                typography.label,
                st.center,
                { color: active ? c.textPrimary : off ? c.textDisabled : c.textSecondary },
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
  segmented: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space.xs,
    gap: space.xs,
  },
  segment: {
    flex: 1,
    minHeight: hit.min,
    justifyContent: 'center',
    borderRadius: concentric(radius.md, space.xs),
    borderWidth: stroke.hairline,
    paddingHorizontal: space.sm,
  },
});
