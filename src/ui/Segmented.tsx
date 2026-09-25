import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { keyLook, keyShadow } from './device';
import { Icon } from './Icon';
import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { compactWidth, concentric, hit, icon, radius, space, stroke, typography } from './tokens';

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
  // 狭い画面では鍵を出さない。ラベルが折り返すより、色だけで無効を示すほうが読める。
  const roomy = useWindowDimensions().width >= compactWidth;
  return (
    <View style={[st.segmented, { backgroundColor: c.well }]} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        const off = !active && !!disabled?.(o.value);
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled: off }}
            style={({ pressed }) => {
              // PN-01: 凹んだ溝（well）の中で、選ばれた駒だけがキーとして浮く（#115）
              const look = keyLook(c, 'neutral', false);
              return [
                st.segment,
                active
                  ? {
                      backgroundColor: look.face,
                      borderColor: look.edge,
                      boxShadow: keyShadow(c, look, true),
                    }
                  : {
                      backgroundColor: pressed ? c.surfaceHover : 'transparent',
                      borderColor: 'transparent',
                    },
              ];
            }}
          >
            <View style={st.inner}>
              {off && roomy ? <Icon name="lock" color={c.textDisabled} size={icon.sm} /> : null}
              <Text
                style={[
                  typography.label,
                  st.center,
                  { color: active ? c.textPrimary : off ? c.textDisabled : c.textSecondary },
                ]}
              >
                {o.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs },
  center: { alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  segmented: {
    flexDirection: 'row',
    borderRadius: radius.md,
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
