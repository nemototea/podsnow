import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';

import { BOTTOM_GAP, BottomInsetProvider, useBottomInset } from './BottomInset';
import { useAppTheme } from './ThemeContext';

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  /** スクロールの外に重ねる要素（FAB、トースト）。 */
  overlay?: ReactNode;
  /**
   * 画面下部に固定する操作バー（エディタのトランスポートなど）。
   * 高さを実測して `useBottomInset()` に流すので、トーストがこれを覆わない（Issue #89）。
   * safe area の下端はここで足すため、バー側で余白を持たなくてよい。
   */
  bottomBar?: ReactNode;
}

export function Screen(props: ScreenProps) {
  return (
    <BottomInsetProvider>
      <ScreenBody {...props} />
    </BottomInsetProvider>
  );
}

function ScreenBody({
  children,
  scroll = true,
  padded = true,
  style,
  overlay,
  bottomBar,
}: ScreenProps) {
  const c = useAppTheme();
  const insets = useSafeAreaInsets();
  const { barHeight, setBarHeight } = useBottomInset();
  const inner = padded ? [s.padded, style] : style;
  return (
    <SafeAreaView style={[s.root, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[inner, { paddingBottom: 40 + barHeight }]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[s.root, inner]}>{children}</View>
      )}
      {bottomBar ? (
        <View
          style={{ paddingBottom: insets.bottom }}
          onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
        >
          {bottomBar}
        </View>
      ) : null}
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
  const t = useT();
  return (
    <View style={s.header}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t.a11y.back}
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
  const t = useT();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel={t.a11y.close} />
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

/**
 * トースト。下部の操作エリアには**重ねず、その上に出す**（Issue #89）。
 * 位置は定数ではなく `useBottomInset()` の実測値から決める。下へスワイプで消せる。
 */
export function Toast({
  toast,
  onAction,
  onDismiss,
}: {
  toast: { text: string; action?: string } | null;
  onAction?: () => void;
  /** スワイプで閉じられたとき。省略時はスワイプしても消えない。 */
  onDismiss?: () => void;
}) {
  const c = useAppTheme();
  const insets = useSafeAreaInsets();
  const { barHeight, setToastHeight } = useBottomInset();
  const [anim] = useState(() => new Animated.Value(0));
  const [drag] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(anim, { toValue: toast ? 1 : 0, duration: 160, useNativeDriver: true }).start();
    if (!toast) drag.setValue(0);
  }, [toast, anim, drag]);

  // 消えたら高さを 0 に戻す（FAB を元の位置へ戻すため）。
  useEffect(() => {
    if (!toast) setToastHeight(0);
  }, [toast, setToastHeight]);

  // 下へ一定量スワイプしたら閉じる。横スワイプや上方向は拾わない。
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          if (g.dy > 24) onDismiss?.();
          else Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [drag, onDismiss],
  );

  if (!toast) return null;
  return (
    <Animated.View
      {...pan.panHandlers}
      onLayout={(e) => setToastHeight(e.nativeEvent.layout.height)}
      style={[
        s.toast,
        {
          backgroundColor: c.panel2,
          borderColor: c.line,
          opacity: anim,
          // 操作バーがあればその上、無ければ safe area の上。
          bottom: (barHeight || insets.bottom) + BOTTOM_GAP,
          transform: [{ translateY: drag }],
        },
      ]}
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

/**
 * 画面右下のフローティングボタン。トーストが出ているあいだは、その分だけ上へ退避する
 * （重ねず押し上げる = M3 の Snackbar と FAB の扱い / Issue #89）。
 * `Screen` の `overlay` に置いて使う。
 */
export function Fab({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const c = useAppTheme();
  const insets = useSafeAreaInsets();
  const { toastHeight } = useBottomInset();
  const [shift] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(shift, {
      toValue: toastHeight > 0 ? -(toastHeight + BOTTOM_GAP) : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [toastHeight, shift]);
  return (
    <Animated.View
      style={[s.fab, { bottom: insets.bottom + BOTTOM_GAP, transform: [{ translateY: shift }] }]}
    >
      <Pressable
        onPress={onPress}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        style={[s.fabInner, { backgroundColor: c.accent }]}
      >
        <Text style={s.fabText}>{label}</Text>
      </Pressable>
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
  // bottom は実測値から決めるのでここには置かない（Issue #89）。
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  fab: { position: 'absolute', right: 20 },
  fabInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabText: { fontSize: 28, color: '#141414', marginTop: -2 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
});
