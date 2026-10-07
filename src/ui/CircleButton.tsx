import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { Icon, type IconName } from './Icon';
import { useAppTheme } from './ThemeContext';
import { hit, hitSlop, icon, pressScale, radius } from './tokens';

/**
 * 丸い操作。`white` は一覧の右端の白い丸（見本 `.minicircle`、32）、`accent` は番組画面の
 * 録音の丸（見本 `.bigplay`、56。アクセントの地に黒）。触れる面は hitSlop で 48 まで広げる。
 */
export function CircleButton({
  name,
  label,
  onPress,
  kind = 'white',
  busy,
  disabled,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
  kind?: 'white' | 'accent';
  busy?: boolean;
  disabled?: boolean;
}) {
  const c = useAppTheme();
  const size = kind === 'accent' ? hit.roundAction : hit.rowAction;
  const bg = kind === 'accent' ? c.accentSolid : c.inverseSurface;
  const fg = kind === 'accent' ? c.accentOnSolid : c.inverseText;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, ...(busy ? { busy } : {}) }}
      hitSlop={hitSlop(size)}
      style={({ pressed }) => [
        s.circle,
        { width: size, height: size, backgroundColor: disabled ? c.surfaceHover : bg },
        pressed ? { transform: [{ scale: pressScale }] } : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Icon
          name={name}
          color={disabled ? c.textDisabled : fg}
          size={kind === 'accent' ? icon.round : icon.circle}
        />
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  circle: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
