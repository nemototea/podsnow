import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';

import { BOTTOM_GAP, BottomInsetProvider, useBottomInset } from './BottomInset';
import { Icon, type IconName } from './Icon';
import { Text, TextInput } from './Text';
import { useAppTheme } from './ThemeContext';
import {
  compactWidth,
  concentric,
  gutter,
  gutterCompact,
  hit,
  hitSlop,
  icon,
  motion,
  pressScale,
  radius,
  space,
  stroke,
  tabularNums,
  tone as toneOf,
  typography,
  type ToneName,
} from './tokens';
import { useReducedMotion } from './useReducedMotion';

export function useGutter(): number {
  const { width } = useWindowDimensions();
  return width < compactWidth ? gutterCompact : gutter;
}

export function useCompact(): boolean {
  const { width } = useWindowDimensions();
  return width < compactWidth;
}

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  overlay?: ReactNode;
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
  const g = useGutter();
  const { barHeight, setBarHeight, toastHeight } = useBottomInset();
  const inner = padded ? [{ paddingHorizontal: g, paddingTop: space.sm }, style] : style;
  const bottomPad = space.xxxl + (bottomBar ? 0 : insets.bottom) + toastHeight;
  return (
    <SafeAreaView style={[s.root, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={[inner, { paddingBottom: bottomPad }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[s.root, inner]}>{children}</View>
        )}
        {bottomBar ? (
          <View
            style={[
              s.bottomBar,
              {
                paddingBottom: insets.bottom + space.sm,
                paddingHorizontal: g,
                backgroundColor: c.bg,
                borderTopColor: c.border,
              },
            ]}
            onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
          >
            {bottomBar}
          </View>
        ) : barHeight ? (
          <ResetBar onReset={() => setBarHeight(0)} />
        ) : null}
      </KeyboardAvoidingView>
      {overlay}
    </SafeAreaView>
  );
}

function ResetBar({ onReset }: { onReset: () => void }) {
  useEffect(onReset, [onReset]);
  return null;
}

export function IconButton({
  name,
  label,
  onPress,
  disabled,
  color,
  showLabel,
  selected,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
  showLabel?: boolean;
  selected?: boolean;
}) {
  const c = useAppTheme();
  const fg = disabled ? c.textDisabled : (color ?? c.textPrimary);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, ...(selected ? { selected } : {}) }}
      style={({ pressed }) => [
        showLabel ? s.iconButtonLabeled : s.iconButton,
        { backgroundColor: pressed ? c.surfaceHover : 'transparent' },
      ]}
    >
      <Icon name={name} color={fg} />
      {showLabel ? (
        <Text style={[typography.caption, { color: disabled ? c.textDisabled : c.textSecondary }]}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function Header({
  title,
  subtitle,
  onBack,
  right,
  large,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  large?: boolean;
}) {
  const c = useAppTheme();
  const t = useT();
  return (
    <View style={s.header}>
      {onBack ? (
        <View style={s.headerBack}>
          <IconButton name="back" label={t.a11y.back} onPress={onBack} />
        </View>
      ) : null}
      <View style={s.flex}>
        <Text
          style={[large ? typography.title : typography.bodyStrong, { color: c.textPrimary }]}
          numberOfLines={2}
          accessibilityRole="header"
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[typography.caption, { color: c.textSecondary }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function Eyebrow({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const c = useAppTheme();
  return (
    <View style={s.eyebrowRow}>
      <Text
        style={[typography.overline, s.flex, { color: c.textSecondary }]}
        accessibilityRole="header"
      >
        {children}
      </Text>
      {right}
    </View>
  );
}

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  const c = useAppTheme();
  return (
    <View style={s.sectionHeader}>
      <Text
        style={[typography.heading, s.flex, { color: c.textPrimary }]}
        accessibilityRole="header"
      >
        {title}
      </Text>
      {right}
    </View>
  );
}

export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
  raised,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
  raised?: boolean;
}) {
  const c = useAppTheme();
  const base = raised ? c.surfaceRaised : c.surface;
  const body = (pressed: boolean) => (
    <View style={[s.card, { backgroundColor: pressed ? c.surfaceHover : base }, style]}>
      {children}
    </View>
  );
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
    >
      {({ pressed }) => body(pressed)}
    </Pressable>
  ) : (
    body(false)
  );
}

export type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  style,
  accessibilityLabel,
  icon: iconName,
  compact,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  icon?: IconName;
  compact?: boolean;
}) {
  const c = useAppTheme();
  const reduced = useReducedMotion();
  const off = disabled || busy;
  const look = (pressed: boolean): { bg: string; border: string; fg: string } => {
    if (off) {
      return {
        bg: kind === 'ghost' ? 'transparent' : c.surfaceRaised,
        border: kind === 'ghost' ? 'transparent' : c.border,
        fg: c.textDisabled,
      };
    }
    switch (kind) {
      case 'primary':
        return {
          bg: pressed ? c.accentSolidPressed : c.accentSolid,
          border: c.isDark ? (pressed ? c.accentSolidPressed : c.accentSolid) : c.accentBorder,
          fg: c.accentOnSolid,
        };
      case 'danger':
        return {
          bg: pressed ? c.dangerSolidPressed : c.dangerSolid,
          border: pressed ? c.dangerSolidPressed : c.dangerSolid,
          fg: c.dangerOnSolid,
        };
      case 'secondary':
        return {
          bg: pressed ? c.surfaceHover : 'transparent',
          border: c.borderStrong,
          fg: c.textPrimary,
        };
      case 'ghost':
        return {
          bg: pressed ? c.surfaceHover : 'transparent',
          border: 'transparent',
          fg: c.textPrimary,
        };
    }
  };
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={({ pressed }) => {
        const l = look(pressed);
        return [
          s.button,
          compact ? s.buttonCompact : null,
          {
            backgroundColor: l.bg,
            borderColor: l.border,
            transform: [{ scale: pressed && !reduced ? pressScale : 1 }],
          },
          style,
        ];
      }}
    >
      {({ pressed }) => {
        const l = look(pressed);
        return (
          <>
            {busy ? (
              <ActivityIndicator color={l.fg} />
            ) : iconName ? (
              <Icon name={iconName} color={l.fg} size={icon.sm} />
            ) : null}
            <Text style={[typography.label, s.buttonLabel, { color: l.fg }]}>{label}</Text>
          </>
        );
      }}
    </Pressable>
  );
}

export function Row({
  label,
  sub,
  right,
  onPress,
  danger,
  icon: iconName,
  last,
  accessibilityLabel,
  mono,
  below,
}: {
  label: string;
  sub?: string;
  below?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  danger?: boolean;
  icon?: IconName;
  last?: boolean;
  accessibilityLabel?: string;
  mono?: string;
}) {
  const c = useAppTheme();
  const body = (pressed: boolean) => (
    <View
      style={[
        s.row,
        {
          borderBottomColor: c.border,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          backgroundColor: pressed ? c.surfaceHover : 'transparent',
        },
      ]}
    >
      {mono ? (
        <Text style={[typography.mono, tabularNums, s.rowMono, { color: c.textTertiary }]}>
          {mono}
        </Text>
      ) : null}
      {iconName ? (
        <Icon name={iconName} color={danger ? c.dangerText : c.textSecondary} size={icon.sm} />
      ) : null}
      <View style={s.flex}>
        <Text style={[typography.body, { color: danger ? c.dangerText : c.textPrimary }]}>
          {label}
        </Text>
        {sub ? <Text style={[typography.caption, { color: c.textSecondary }]}>{sub}</Text> : null}
      </View>
      {right ?? (onPress ? <Icon name="arrow" color={c.textTertiary} size={icon.sm} /> : null)}
    </View>
  );
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (sub ? `${label}, ${sub}` : label)}
    >
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
        left: space.sm,
        right: space.sm,
      }}
      style={[
        s.toggle,
        {
          backgroundColor: value ? c.accentSolid : c.surfaceRaised,
          borderColor: value ? (c.isDark ? c.accentSolid : c.accentBorder) : c.borderStrong,
        },
      ]}
    >
      <View
        style={[
          s.knob,
          {
            backgroundColor: value ? c.accentOnSolid : c.textSecondary,
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
  const insets = useSafeAreaInsets();
  const g = useGutter();
  const { height } = useWindowDimensions();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable
          style={[s.backdrop, { backgroundColor: c.overlayScrim }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t.a11y.close}
        />
        <View
          style={[
            s.sheet,
            {
              backgroundColor: c.surfaceRaised,
              paddingHorizontal: g,
              paddingBottom: insets.bottom + space.lg,
              maxHeight: height * 0.88,
            },
          ]}
          accessibilityViewIsModal
        >
          <View style={s.sheetHead}>
            <View style={s.flex}>
              {title ? (
                <Text
                  style={[typography.heading, { color: c.textPrimary }]}
                  accessibilityRole="header"
                >
                  {title}
                </Text>
              ) : null}
              {subtitle ? (
                <Text style={[typography.caption, { color: c.textSecondary }]}>{subtitle}</Text>
              ) : null}
            </View>
            <View style={s.sheetClose}>
              <IconButton name="close" label={t.a11y.close} onPress={onClose} />
            </View>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Toast({
  toast,
  onAction,
  onDismiss,
}: {
  toast: { text: string; action?: string } | null;
  onAction?: () => void;
  onDismiss?: () => void;
}) {
  const c = useAppTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const g = useGutter();
  const { barHeight, setToastHeight } = useBottomInset();
  const [anim] = useState(() => new Animated.Value(0));
  const [drag] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(anim, {
      toValue: toast ? 1 : 0,
      duration: reduced ? 0 : motion.quick,
      useNativeDriver: true,
    }).start();
    if (!toast) drag.setValue(0);
  }, [toast, anim, drag, reduced]);

  useEffect(() => {
    if (!toast) setToastHeight(0);
  }, [toast, setToastHeight]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, gs) => gs.dy > 4 && Math.abs(gs.dy) > Math.abs(gs.dx),
        onPanResponderMove: (_e, gs) => drag.setValue(Math.max(0, gs.dy)),
        onPanResponderRelease: (_e, gs) => {
          if (gs.dy > DISMISS_DRAG) onDismiss?.();
          else Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [drag, onDismiss],
  );

  if (!toast) return null;
  return (
    <Animated.View
      {...pan.panHandlers}
      onLayout={(e) => setToastHeight(e.nativeEvent.layout.height + BOTTOM_GAP)}
      style={[
        s.toast,
        {
          left: g,
          right: g,
          backgroundColor: c.surfaceRaised,
          borderColor: c.borderStrong,
          opacity: anim,
          bottom: (barHeight || insets.bottom) + BOTTOM_GAP,
          transform: reduced ? [] : [{ translateY: drag }],
        },
      ]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <Text style={[typography.body, s.flex, { color: c.textPrimary }]}>{toast.text}</Text>
      {toast.action && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={toast.action}
          style={({ pressed }) => [
            s.toastAction,
            { backgroundColor: pressed ? c.surfaceHover : 'transparent' },
          ]}
        >
          <Text style={[typography.label, { color: c.accentText }]}>{toast.action}</Text>
        </Pressable>
      ) : null}
      {onDismiss ? <IconButton name="close" label={t.a11y.dismiss} onPress={onDismiss} /> : null}
    </Animated.View>
  );
}

export function Loading({ label }: { label?: string }) {
  const c = useAppTheme();
  return (
    <View style={[s.root, s.center, { backgroundColor: c.bg }]}>
      <ActivityIndicator color={c.textSecondary} />
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
  icon: iconName,
  accessibilityLabel,
  disabled,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  tone?: { text: string; border: string; subtle: string };
  icon?: IconName;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const c = useAppTheme();
  const t = tone ?? { text: c.textPrimary, border: c.accentBorder, subtle: c.accentSubtle };
  const fg = disabled ? c.textDisabled : active ? t.text : c.textSecondary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      hitSlop={{ top: hitSlop(CHIP_H), bottom: hitSlop(CHIP_H) }}
      style={({ pressed }) => [
        s.chip,
        {
          borderColor: disabled ? c.border : active ? t.border : c.borderStrong,
          borderWidth: active ? stroke.selected : stroke.hairline,
          backgroundColor: active ? t.subtle : pressed ? c.surfaceHover : 'transparent',
        },
      ]}
    >
      {iconName ? <Icon name={iconName} color={fg} size={icon.sm} /> : null}
      <Text style={[typography.label, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: (v: T) => boolean;
}) {
  const c = useAppTheme();
  return (
    <View
      style={[s.segmented, { backgroundColor: c.surface, borderColor: c.border }]}
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
              s.segment,
              {
                backgroundColor: active
                  ? c.surfaceHover
                  : pressed
                    ? c.surfaceRaised
                    : 'transparent',
                borderBottomColor: active ? c.accentBorder : 'transparent',
              },
            ]}
          >
            <Text
              style={[
                typography.label,
                s.center,
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

export function ProgressBar({
  value,
  label,
  color,
}: {
  value: number | null;
  label: string;
  color?: string;
}) {
  const c = useAppTheme();
  const reduced = useReducedMotion();
  const [slide] = useState(() => new Animated.Value(0));
  const indeterminate = value === null;
  useEffect(() => {
    if (!indeterminate || reduced) return;
    const loop = Animated.loop(
      Animated.timing(slide, { toValue: 1, duration: 1200, useNativeDriver: false }),
    );
    loop.start();
    return () => loop.stop();
  }, [indeterminate, reduced, slide]);
  const pct = value === null ? null : Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <View
      style={[s.track, { backgroundColor: c.surfaceHover }]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      {...(pct === null ? {} : { accessibilityValue: { min: 0, max: 100, now: pct } })}
    >
      {pct === null ? (
        <Animated.View
          style={[
            s.trackFill,
            s.indeterminate,
            {
              backgroundColor: color ?? c.accentSolid,
              left: reduced
                ? '30%'
                : slide.interpolate({ inputRange: [0, 1], outputRange: ['-40%', '100%'] }),
            },
          ]}
        />
      ) : (
        <View
          style={[s.trackFill, { width: `${pct}%`, backgroundColor: color ?? c.accentSolid }]}
        />
      )}
    </View>
  );
}

export type NoticeKind = 'info' | 'warning' | 'error' | 'success' | 'rec';

export function Notice({
  kind = 'info',
  title,
  body,
  action,
}: {
  kind?: NoticeKind;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  const c = useAppTheme();
  const toneName: ToneName | null =
    kind === 'warning'
      ? 'mistake'
      : kind === 'error'
        ? 'danger'
        : kind === 'success'
          ? 'success'
          : kind === 'rec'
            ? 'rec'
            : null;
  const tn = toneName ? toneOf(c, toneName) : null;
  const iconName: IconName =
    kind === 'warning' || kind === 'error' ? 'warning' : kind === 'success' ? 'check' : 'flag';
  return (
    <View
      style={[
        s.notice,
        { backgroundColor: tn ? tn.subtle : c.surface, borderColor: tn ? tn.border : c.border },
      ]}
      accessibilityRole={kind === 'error' ? 'alert' : undefined}
    >
      <Icon name={iconName} color={tn ? tn.text : c.textSecondary} size={icon.sm} />
      <View style={[s.flex, { gap: space.xs }]}>
        <Text style={[typography.bodyStrong, { color: c.textPrimary }]}>{title}</Text>
        {body ? <Text style={[typography.caption, { color: c.textSecondary }]}>{body}</Text> : null}
        {action}
      </View>
    </View>
  );
}

export function Field({
  label,
  help,
  error,
  multiline,
  style,
  ...input
}: TextInputProps & {
  label: string;
  help?: string;
  error?: string | null;
}) {
  const c = useAppTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={s.field}>
      <Text style={[typography.label, { color: c.textSecondary }]}>{label}</Text>
      <TextInput
        {...input}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        accessibilityLabel={input.accessibilityLabel ?? label}
        {...(error || help ? { accessibilityHint: error ?? help } : {})}
        placeholderTextColor={c.textTertiary}
        onFocus={(e) => {
          setFocused(true);
          input.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          input.onBlur?.(e);
        }}
        style={[
          s.input,
          multiline ? s.multiline : null,
          {
            color: c.textPrimary,
            backgroundColor: c.bg,
            borderColor: error ? c.dangerBorder : focused ? c.focusRing : c.borderStrong,
            borderWidth: focused || error ? stroke.selected : stroke.hairline,
          },
          style,
        ]}
      />
      {error ? (
        <Text
          style={[typography.caption, { color: c.dangerText }]}
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : help ? (
        <Text style={[typography.caption, { color: c.textTertiary }]}>{help}</Text>
      ) : null}
    </View>
  );
}

const TOGGLE_W = 52;
const TOGGLE_H = 32;
const TOGGLE_PAD = 4;
const KNOB = 22;
const KNOB_TRAVEL = TOGGLE_W - 2 - TOGGLE_PAD * 2 - KNOB;
const CHIP_H = 40;
const DISMISS_DRAG = 24;

const s = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  bottomBar: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: hit.min + space.sm,
    paddingVertical: space.xs,
    gap: space.sm,
  },
  headerBack: { marginLeft: -space.md },
  iconButton: {
    minWidth: hit.min,
    minHeight: hit.min,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonLabeled: {
    minWidth: hit.min + space.xl,
    minHeight: hit.min,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
    gap: space.hair,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.xl,
    marginBottom: space.sm,
    gap: space.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.xxl,
    marginBottom: space.sm,
    gap: space.sm,
  },
  card: {
    borderRadius: radius.lg,
    padding: gutter,
    marginBottom: space.md,
  },
  button: {
    minHeight: hit.button,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonCompact: { minHeight: hit.min, paddingHorizontal: space.md },
  buttonLabel: { textAlign: 'center', flexShrink: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: hit.min + space.sm,
    paddingVertical: space.md,
    gap: space.md,
  },
  rowMono: { minWidth: space.xxl },
  rowBelow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
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
    paddingTop: space.md,
    gap: space.xs,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingTop: space.xs,
  },
  sheetClose: { marginRight: -space.md, marginTop: -space.sm },
  toast: {
    position: 'absolute',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    paddingVertical: space.xs,
    minHeight: hit.min + space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  toastAction: {
    minHeight: hit.min,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    justifyContent: 'center',
  },
  chip: {
    minHeight: CHIP_H,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: space.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    borderBottomWidth: stroke.selected,
    paddingHorizontal: space.sm,
  },
  track: { height: space.sm, borderRadius: radius.pill, overflow: 'hidden' },
  trackFill: { height: space.sm, borderRadius: radius.pill },
  indeterminate: { position: 'absolute', width: '40%' },
  notice: {
    flexDirection: 'row',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
    marginBottom: space.md,
    alignItems: 'flex-start',
  },
  field: { gap: space.sm, marginBottom: space.lg },
  input: {
    ...typography.body,
    minHeight: hit.button,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  multiline: { minHeight: 128 },
});

export type { TextStyle, ViewStyle };
export { Icon, type IconName } from './Icon';
export { Text, TextInput } from './Text';
export { concentric, gutter, hit, hitSlop, icon, radius, space, typography };
