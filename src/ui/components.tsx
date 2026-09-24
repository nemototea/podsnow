import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  FadeInDown,
  FadeOutDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';

import { BOTTOM_GAP, BottomInsetProvider, useBottomInset } from './BottomInset';
import { Icon, type IconName } from './Icon';
import { Text, TextInput } from './Text';
import { useAppTheme } from './ThemeContext';
import {
  buttonDepth,
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
  /** 画面上端の安全域を自分で取る（ネイティブのヘッダーを出さない Home だけ）。 */
  edgeTop?: boolean;
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
  edgeTop,
}: ScreenProps) {
  const c = useAppTheme();
  const insets = useSafeAreaInsets();
  const g = useGutter();
  const { barHeight, setBarHeight, toastHeight } = useBottomInset();
  const inner = padded ? [{ paddingHorizontal: g, paddingTop: space.sm }, style] : style;
  const bottomPad = space.xxxl + (bottomBar ? 0 : insets.bottom) + toastHeight;
  return (
    <SafeAreaView
      style={[s.root, { backgroundColor: c.bg }]}
      edges={edgeTop ? ['top', 'left', 'right'] : ['left', 'right']}
    >
      <View style={s.root}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={[inner, { paddingBottom: bottomPad }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            automaticallyAdjustKeyboardInsets
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
      </View>
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
  const [pressed, setPressed] = useState(false);
  const tactile = kind === 'primary' || kind === 'secondary';
  const depressed = pressed && !off && tactile && !reduced;
  const pressStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale:
          reduced || off || tactile
            ? 1
            : withTiming(pressed ? pressScale : 1, { duration: motion.instant }),
      },
      {
        translateY:
          reduced || off
            ? 0
            : withTiming(depressed ? buttonDepth.travel : 0, { duration: motion.instant }),
      },
    ],
  }));
  // Android 7/8 では boxShadow が未対応。形は不透明な輪郭で伝える。
  const hardShadow =
    tactile && !off && (Platform.OS !== 'android' || Number(Platform.Version) >= 28);
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
          border: c.isDark ? c.controlShadow : c.controlBorder,
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
          bg: pressed ? c.surfaceHover : c.isDark ? c.surfaceRaised : c.surface,
          border: c.isDark ? c.borderStrong : c.controlBorder,
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
  const l = look(pressed);
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        setPressed(true);
      }}
      onPressOut={() => {
        setPressed(false);
      }}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={[
        s.button,
        compact ? s.buttonCompact : null,
        {
          backgroundColor: l.bg,
          borderColor: l.border,
          borderWidth: tactile ? stroke.selected : stroke.hairline,
          boxShadow: hardShadow
            ? [
                {
                  offsetX: depressed ? 0 : buttonDepth.offsetX,
                  offsetY: depressed ? buttonDepth.pressedOffsetY : buttonDepth.offsetY,
                  blurRadius: 0,
                  color: c.controlShadow,
                },
              ]
            : [],
        },
        pressStyle,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={l.fg} />
      ) : iconName ? (
        <Icon name={iconName} color={l.fg} size={icon.sm} />
      ) : null}
      <Text style={[typography.label, s.buttonLabel, { color: l.fg }]}>{label}</Text>
    </AnimatedPressable>
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
  const content = (
    <>
      {mono ? (
        <Text style={[typography.numeric, tabularNums, s.rowMono, { color: c.textTertiary }]}>
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
        {below ? <View style={s.rowBelow}>{below}</View> : null}
      </View>
    </>
  );
  const divider = {
    borderBottomColor: c.border,
    borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
  };
  if (!onPress) {
    return (
      <View style={[s.row, divider]}>
        {content}
        {right}
      </View>
    );
  }
  const a11y = accessibilityLabel ?? (sub ? `${label}, ${sub}` : label);
  if (right) {
    // 右の操作（メニュー・ボタン・ネイティブのピッカー）は行の押下の外に置く。
    // 入れ子にすると、右を押したときに行の移動も同時に起きうる。
    return (
      <View style={[s.rowOuter, divider]}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={a11y}
          style={s.flex}
        >
          {({ pressed }) => (
            <View style={[s.row, { backgroundColor: pressed ? c.surfaceHover : 'transparent' }]}>
              {content}
            </View>
          )}
        </Pressable>
        {right}
      </View>
    );
  }
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y}>
      {({ pressed }) => (
        <View
          style={[s.row, divider, { backgroundColor: pressed ? c.surfaceHover : 'transparent' }]}
        >
          {content}
          <Icon name="arrow" color={c.textTertiary} size={icon.sm} />
        </View>
      )}
    </Pressable>
  );
}

export function Toggle({
  value,
  onChange,
  accessibilityLabel,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  accessibilityLabel?: string;
  /** 押せない理由は文で書かず、近くに解決の操作（例: BGM を入れる）を置く。 */
  disabled?: boolean;
}) {
  const c = useAppTheme();
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      disabled={!!disabled}
      trackColor={{ false: c.surfaceHover, true: c.accentSolid }}
      ios_backgroundColor={c.surfaceHover}
      {...(Platform.OS === 'ios' ? {} : { thumbColor: value ? c.accentOnSolid : c.textSecondary })}
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
    />
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
  const drag = useSharedValue(0);

  useEffect(() => {
    if (!toast) setToastHeight(0);
    drag.set(0);
  }, [toast, setToastHeight, drag]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(DRAG_START)
        .failOffsetX([-DRAG_START, DRAG_START])
        .onUpdate((e) => {
          drag.set(Math.max(0, e.translationY));
        })
        .onEnd((e) => {
          if (e.translationY > DISMISS_DRAG && onDismiss) runOnJS(onDismiss)();
          else drag.set(withSpring(0, SPRING));
        }),
    [drag, onDismiss],
  );
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.get() }] }));

  if (!toast) return null;
  return (
    <GestureDetector gesture={pan}>
      <Reanimated.View
        key={toast.text}
        {...(reduced
          ? {}
          : {
              entering: FadeInDown.springify().damping(SPRING.damping),
              exiting: FadeOutDown.duration(motion.quick),
            })}
        onLayout={(e) => setToastHeight(e.nativeEvent.layout.height + BOTTOM_GAP)}
        style={[
          s.toast,
          {
            left: g,
            right: g,
            backgroundColor: c.surfaceRaised,
            borderColor: c.borderStrong,
            bottom: (barHeight || insets.bottom) + BOTTOM_GAP,
          },
          reduced ? null : dragStyle,
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
      </Reanimated.View>
    </GestureDetector>
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
  // 呼び出し側の書体スタイル（typography.numeric など）に含まれる lineHeight も入力欄には渡さない（s.input）。
  const { lineHeight: _lineHeight, ...inputStyle } = StyleSheet.flatten(style) ?? {};
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
          multiline && Platform.OS === 'ios' ? s.multilineLeading : null,
          {
            color: c.textPrimary,
            backgroundColor: c.bg,
            borderColor: error ? c.dangerBorder : focused ? c.focusRing : c.borderStrong,
            borderWidth: focused || error || !c.isDark ? stroke.selected : stroke.hairline,
          },
          inputStyle,
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

const CHIP_H = 40;
const AnimatedPressable = Reanimated.createAnimatedComponent(Pressable);
const DISMISS_DRAG = 24;
const DRAG_START = 4;
const SPRING = { damping: 20, stiffness: 240, mass: 0.8 } as const;

const s = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  bottomBar: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.md },
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
  rowOuter: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  rowMono: { minWidth: space.xxl },
  rowBelow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
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
  // 入力欄には lineHeight を渡さない。Android の TextInput は lineHeight を字の上に積むので、
  // 字が上に寄り、カーソルが字より大きく伸びる（iOS の 1 行入力でも字が下にずれる）。
  // 行間は複数行の iOS だけ `multilineLeading` で付ける。
  input: {
    fontSize: typography.body.fontSize,
    fontWeight: typography.body.fontWeight,
    minHeight: hit.button,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  multiline: { minHeight: 128 },
  multilineLeading: { lineHeight: typography.body.lineHeight },
});

export type { TextStyle, ViewStyle };
export { Icon, type IconName } from './Icon';
export { Segmented, type SegmentedProps } from './Segmented';
export { Sheet, type SheetProps } from './Sheet';
export { Text, TextInput } from './Text';
export { concentric, gutter, hit, hitSlop, icon, radius, space, typography };
