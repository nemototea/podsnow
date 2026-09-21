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
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';

import { BOTTOM_GAP, BottomInsetProvider, useBottomInset } from './BottomInset';
import { useAppTheme } from './ThemeContext';
import {
  concentric,
  disabledOpacity,
  gutter,
  hit,
  hitSlop,
  motion,
  pressScale,
  icon,
  radius,
  space,
  typography,
} from './tokens';
import { useReducedMotion } from './useReducedMotion';

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
          contentContainerStyle={[inner, { paddingBottom: space.xxxl + barHeight }]}
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
          accessibilityRole="button"
          accessibilityLabel={t.a11y.back}
          style={({ pressed }) => [
            s.back,
            { backgroundColor: pressed ? c.surfaceHover : 'transparent' },
          ]}
        >
          <Text style={[s.backGlyph, { color: c.textPrimary }]}>‹</Text>
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text
          style={[typography.title, { color: c.textPrimary }]}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[typography.caption, { color: c.textSecondary, marginTop: space.hair }]}
            numberOfLines={1}
          >
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
  return (
    <Text
      style={[typography.overline, s.eyebrow, { color: c.textSecondary }]}
      accessibilityRole="header"
    >
      {children}
    </Text>
  );
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
  const body = (pressed: boolean) => (
    <View
      style={[
        s.card,
        { backgroundColor: pressed ? c.surfaceHover : c.surface, borderColor: c.border },
        style,
      ]}
    >
      {children}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button">
      {({ pressed }) => body(pressed)}
    </Pressable>
  ) : (
    body(false)
  );
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
  const reduced = useReducedMotion();
  // 塗りは押下用の段を持つ。不透明度で暗くすると、背面しだいでラベルとの比が変わる。
  const fill = {
    primary: [c.accentSolid, c.accentSolidPressed, c.accentOnSolid],
    danger: [c.dangerSolid, c.dangerSolidPressed, c.dangerOnSolid],
    secondary: [c.surfaceRaised, c.surfaceHover, c.textPrimary],
    ghost: ['transparent', c.surfaceHover, c.textPrimary],
  }[kind] as [string, string, string];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        s.button,
        {
          backgroundColor: pressed ? fill[1] : fill[0],
          borderColor: kind === 'ghost' ? c.borderStrong : pressed ? fill[1] : fill[0],
          opacity: disabled ? disabledOpacity : 1,
          transform: [{ scale: pressed && !reduced ? pressScale : 1 }],
        },
        style,
      ]}
    >
      <Text style={[typography.bodyStrong, { color: fill[2] }]} numberOfLines={1}>
        {label}
      </Text>
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
  const body = (pressed: boolean) => (
    <View
      style={[
        s.row,
        { borderBottomColor: c.border, backgroundColor: pressed ? c.surfaceHover : 'transparent' },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[typography.body, { color: danger ? c.dangerText : c.textPrimary }]}>
          {label}
        </Text>
        {sub ? (
          <Text style={[typography.caption, { color: c.textSecondary, marginTop: space.hair }]}>
            {sub}
          </Text>
        ) : null}
      </View>
      {right ??
        (onPress ? (
          <Text
            style={{ color: c.textTertiary, fontSize: icon.sm }}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            ›
          </Text>
        ) : null)}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {({ pressed }) => body(pressed)}
    </Pressable>
  ) : (
    body(false)
  );
}

export function Toggle({
  value,
  onChange,
  accessibilityLabel,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  accessibilityLabel?: string;
}) {
  const c = useAppTheme();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      hitSlop={{
        top: hitSlop(TOGGLE_H),
        bottom: hitSlop(TOGGLE_H),
        left: hitSlop(TOGGLE_W),
        right: hitSlop(TOGGLE_W),
      }}
      style={[
        s.toggle,
        {
          backgroundColor: value ? c.accentSolid : c.surfaceRaised,
          borderColor: value ? c.accentSolid : c.borderStrong,
        },
      ]}
    >
      <View
        style={[
          s.knob,
          {
            backgroundColor: value ? c.accentOnSolid : c.textTertiary,
            transform: [{ translateX: value ? KNOB_TRAVEL : 0 }],
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
      <Pressable
        style={[s.backdrop, { backgroundColor: c.overlayScrim }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t.a11y.close}
      />
      <View style={[s.sheet, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View
          style={[s.grip, { backgroundColor: c.borderStrong }]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        {title ? (
          <Text style={[typography.heading, { color: c.textPrimary }]} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text style={[typography.caption, { color: c.textSecondary, marginBottom: space.sm }]}>
            {subtitle}
          </Text>
        ) : null}
        <ScrollView style={{ maxHeight: SHEET_MAX_H }}>{children}</ScrollView>
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
  const reduced = useReducedMotion();
  const { barHeight, setToastHeight } = useBottomInset();
  const [anim] = useState(() => new Animated.Value(0));
  const [drag] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(anim, {
      toValue: toast ? 1 : 0,
      duration: motion.quick,
      useNativeDriver: true,
    }).start();
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
          if (g.dy > DISMISS_DRAG) onDismiss?.();
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
          backgroundColor: c.surfaceRaised,
          borderColor: c.border,
          opacity: anim,
          // 操作バーがあればその上、無ければ safe area の上。
          bottom: (barHeight || insets.bottom) + BOTTOM_GAP,
          transform: reduced ? [] : [{ translateY: drag }],
        },
      ]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <Text style={[typography.body, { color: c.textPrimary, flex: 1 }]}>{toast.text}</Text>
      {toast.action && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          hitSlop={hitSlop(typography.label.lineHeight)}
        >
          <Text style={[typography.label, { color: c.accentText }]}>{toast.action}</Text>
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
  accessibilityLabel: string;
}) {
  const c = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { toastHeight } = useBottomInset();
  const [shift] = useState(() => new Animated.Value(0));
  const target = toastHeight > 0 ? -(toastHeight + BOTTOM_GAP) : 0;
  useEffect(() => {
    if (reduced) {
      shift.setValue(target);
      return;
    }
    Animated.timing(shift, {
      toValue: target,
      duration: motion.quick,
      useNativeDriver: true,
    }).start();
  }, [target, shift, reduced]);
  return (
    <Animated.View
      style={[s.fab, { bottom: insets.bottom + BOTTOM_GAP, transform: [{ translateY: shift }] }]}
    >
      <Pressable
        onPress={onPress}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        style={({ pressed }) => [
          s.fabInner,
          {
            backgroundColor: pressed ? c.accentSolidPressed : c.accentSolid,
            transform: [{ scale: pressed && !reduced ? pressScale : 1 }],
          },
        ]}
      >
        <Text style={[s.fabGlyph, { color: c.accentOnSolid }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

export function Loading({ label }: { label?: string }) {
  const c = useAppTheme();
  return (
    <View style={[s.root, s.center, { backgroundColor: c.bg }]}>
      <ActivityIndicator color={c.accentSolid} />
      {label ? (
        <Text
          style={[typography.body, { color: c.textSecondary, marginTop: space.sm }]}
          accessibilityLiveRegion="polite"
        >
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  tone,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  /** 分類を表す色。省略するとアクセント。地と輪郭はトークンで受け取る。 */
  tone?: { text: string; border: string; subtle: string };
}) {
  const c = useAppTheme();
  const t = tone ?? { text: c.accentText, border: c.accentBorder, subtle: c.accentSubtle };
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      hitSlop={{ top: hitSlop(CHIP_H), bottom: hitSlop(CHIP_H) }}
      style={({ pressed }) => [
        s.chip,
        {
          borderColor: active ? t.border : c.borderStrong,
          backgroundColor: active ? t.subtle : pressed ? c.surfaceHover : 'transparent',
        },
      ]}
    >
      <Text style={[typography.label, { color: active ? t.text : c.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

const TOGGLE_W = 48;
const TOGGLE_H = 28;
const TOGGLE_PAD = 3;
const KNOB = 20;
/** つまみが端から端まで動く距離。枠線と内側の余白を引いた実寸から出す。 */
const KNOB_TRAVEL = TOGGLE_W - 2 - TOGGLE_PAD * 2 - KNOB;
const CHIP_H = 30;
const SHEET_MAX_H = 460;
const DISMISS_DRAG = 24;

const s = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  padded: { paddingHorizontal: gutter, paddingTop: space.sm },
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, gap: space.sm },
  back: {
    width: hit.min,
    height: hit.min,
    marginLeft: -space.md,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backGlyph: { fontSize: icon.lg + 2, lineHeight: 34, marginTop: -4 },
  eyebrow: { marginTop: space.xl, marginBottom: space.sm },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
    marginBottom: space.md,
  },
  button: {
    minHeight: hit.min,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: hit.min,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: space.md,
  },
  toggle: {
    width: TOGGLE_W,
    height: TOGGLE_H,
    borderRadius: radius.pill,
    borderWidth: 1,
    padding: TOGGLE_PAD,
    justifyContent: 'center',
  },
  knob: { width: KNOB, height: KNOB, borderRadius: radius.pill },
  backdrop: { flex: 1 },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    padding: space.lg,
    paddingBottom: space.xxl,
    gap: space.xs,
  },
  grip: {
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    alignSelf: 'center',
    marginBottom: space.md,
  },
  // bottom は実測値から決めるのでここには置かない（Issue #89）。
  toast: {
    position: 'absolute',
    left: gutter,
    right: gutter,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  fab: { position: 'absolute', right: gutter + space.xs },
  fabInner: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabGlyph: { fontSize: icon.lg, lineHeight: 32 },
  chip: {
    height: CHIP_H,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/** 画面側でトークンをそのまま使うための再輸出（生の数値を書かないため）。 */
export type { TextStyle, ViewStyle };
export { concentric, gutter, hit, hitSlop, icon, radius, space, typography };
