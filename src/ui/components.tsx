import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppTheme } from './ThemeContext';

export function Screen({
  children,
  scroll = true,
  padded = true,
  style,
  overlay,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  /** スクロールの外に重ねる要素（FAB、トースト、固定フッター）。 */
  overlay?: ReactNode;
}) {
  const c = useAppTheme();
  const inner = padded ? [s.padded, style] : style;
  return (
    <SafeAreaView style={[s.root, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[inner, { paddingBottom: 40 }]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[s.root, inner]}>{children}</View>
      )}
      {overlay}
    </SafeAreaView>
  );
}

export function Header({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const c = useAppTheme();
  return (
    <View style={s.header}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="戻る"
          style={s.back}
        >
          <Text style={[s.backGlyph, { color: c.ink }]}>‹</Text>
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[s.title, { color: c.ink }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[s.subtitle, { color: c.ink2 }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  const c = useAppTheme();
  return <Text style={[s.eyebrow, { color: c.ink2 }]}>{children}</Text>;
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const c = useAppTheme();
  const body = (
    <View style={[s.card, { backgroundColor: c.panel, borderColor: c.line }, style]}>
      {children}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body;
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const c = useAppTheme();
  const bg =
    kind === 'primary'
      ? c.accent
      : kind === 'danger'
        ? c.rec
        : kind === 'secondary'
          ? c.panel2
          : 'transparent';
  const fg = kind === 'primary' ? '#141414' : kind === 'danger' ? '#fff' : c.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        s.button,
        {
          backgroundColor: bg,
          borderColor: kind === 'ghost' ? c.line : bg,
          opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      <Text style={[s.buttonText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Row({
  label,
  sub,
  right,
  onPress,
  danger,
}: {
  label: string;
  sub?: string;
  right?: ReactNode;
  onPress?: () => void;
  danger?: boolean;
}) {
  const c = useAppTheme();
  const body = (
    <View style={[s.row, { borderBottomColor: c.line }]}>
      <View style={{ flex: 1 }}>
        <Text style={[s.rowLabel, { color: danger ? c.rec : c.ink }]}>{label}</Text>
        {sub ? <Text style={[s.rowSub, { color: c.ink2 }]}>{sub}</Text> : null}
      </View>
      {right ?? (onPress ? <Text style={{ color: c.ink3, fontSize: 18 }}>›</Text> : null)}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button">
      {body}
    </Pressable>
  ) : (
    body
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const c = useAppTheme();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={[s.toggle, { backgroundColor: value ? c.accent : c.panel2, borderColor: c.line }]}
    >
      <View
        style={[
          s.knob,
          {
            backgroundColor: value ? '#141414' : c.ink3,
            transform: [{ translateX: value ? 18 : 0 }],
          },
        ]}
      />
    </Pressable>
  );
}

export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const c = useAppTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="閉じる" />
      <View style={[s.sheet, { backgroundColor: c.panel, borderColor: c.line }]}>
        <View style={[s.grip, { backgroundColor: c.ink3 }]} />
        {title ? <Text style={[s.sheetTitle, { color: c.ink }]}>{title}</Text> : null}
        {subtitle ? (
          <Text style={[s.rowSub, { color: c.ink2, marginBottom: 8 }]}>{subtitle}</Text>
        ) : null}
        <ScrollView style={{ maxHeight: 460 }}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

export function Toast({
  toast,
  onAction,
}: {
  toast: { text: string; action?: string } | null;
  onAction?: () => void;
}) {
  const c = useAppTheme();
  const [anim] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(anim, { toValue: toast ? 1 : 0, duration: 160, useNativeDriver: true }).start();
  }, [toast, anim]);
  if (!toast) return null;
  return (
    <Animated.View
      style={[s.toast, { backgroundColor: c.panel2, borderColor: c.line, opacity: anim }]}
      accessibilityLiveRegion="polite"
    >
      <Text style={{ color: c.ink, flex: 1 }}>{toast.text}</Text>
      {toast.action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={{ color: c.accent, fontWeight: '700' }}>{toast.action}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

export function Loading({ label }: { label?: string }) {
  const c = useAppTheme();
  return (
    <View
      style={[s.root, { backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }]}
    >
      <ActivityIndicator color={c.accent} />
      {label ? <Text style={{ color: c.ink2, marginTop: 8 }}>{label}</Text> : null}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  color,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  color?: string;
}) {
  const c = useAppTheme();
  const tone = color ?? c.accent;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[
        s.chip,
        {
          borderColor: active ? tone : c.line,
          backgroundColor: active ? `${tone}22` : 'transparent',
        },
      ]}
    >
      <Text style={{ color: active ? tone : c.ink2, fontSize: 12, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  padded: { paddingHorizontal: 16, paddingTop: 8 },
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backGlyph: { fontSize: 30, lineHeight: 34, marginTop: -4 },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 12, marginTop: 2 },
  eyebrow: { fontSize: 11, letterSpacing: 1.6, marginTop: 18, marginBottom: 8 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 12 },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  buttonText: { fontSize: 15, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowLabel: { fontSize: 15 },
  rowSub: { fontSize: 12, marginTop: 3 },
  toggle: { width: 44, height: 26, borderRadius: 13, borderWidth: 1, padding: 2 },
  knob: { width: 20, height: 20, borderRadius: 10 },
  backdrop: { flex: 1, backgroundColor: '#00000088' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: 16,
    paddingBottom: 32,
  },
  grip: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
    opacity: 0.5,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 110,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
});
