import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  useWindowDimensions,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, {
  Easing,
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

import {
  BOTTOM_GAP,
  BottomInsetProvider,
  keyboardLift,
  useBottomInset,
  useFloatingInset,
} from './BottomInset';
import { notify } from './alerts';
import { Icon, type IconName } from './Icon';
import type { TermInfo } from './menuTypes';
import { KeyboardScroll } from './KeyboardScroll';
import { Text, TextInput } from './Text';
import { useAppTheme } from './ThemeContext';
import {
  chip as chipSize,
  compactWidth,
  concentric,
  field,
  fieldPadding,
  gutter,
  gutterCompact,
  hit,
  hitSlop,
  icon,
  motion,
  pill as pillSize,
  pressScale,
  pressedOpacity,
  radius,
  shadow,
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
  /**
   * 下部バーを余白も地の色も付けずに置く（見本 `.sheet` のように、バー自身が地の色と下の安全域を持つとき）。
   */
  bottomBarBare?: boolean;
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
  bottomBarBare,
}: ScreenProps) {
  const c = useAppTheme();
  const insets = useSafeAreaInsets();
  const g = useGutter();
  const { barHeight, setBarHeight, toastHeight } = useBottomInset();
  // ミニプレーヤーが出ている間は、その高さだけ下部バー・内容の下を空けて覆わせない（Issue #164）
  const floating = useFloatingInset();
  const inner = padded ? [{ paddingHorizontal: g, paddingTop: space.sm }, style] : style;
  const bottomPad = space.xxxl + (bottomBar ? 0 : insets.bottom + floating) + toastHeight;
  return (
    <SafeAreaView
      style={[s.root, { backgroundColor: c.bg }]}
      edges={edgeTop ? ['top', 'left', 'right'] : ['left', 'right']}
    >
      <View style={s.root}>
        {scroll ? (
          // キーボードが出たら入力中の欄が見えるまでずらす（Issue #132、`KeyboardScroll`）。
          // 下部バーはキーボードの裏に隠れたままにする（入力中は使わないので、見える範囲を削らない）。
          <KeyboardScroll contentContainerStyle={[inner, { paddingBottom: bottomPad }]}>
            {children}
          </KeyboardScroll>
        ) : (
          <View style={[s.root, inner]}>{children}</View>
        )}
        {bottomBar ? (
          <View
            style={
              bottomBarBare
                ? { paddingBottom: floating }
                : [
                    s.bottomBar,
                    {
                      paddingBottom: insets.bottom + space.sm + floating,
                      paddingHorizontal: g,
                      backgroundColor: c.bg,
                    },
                  ]
            }
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

/**
 * アイコンだけの操作（見本 `.ib`）。見た目は 32 の丸（`large` は収録画面の操作バーの 44）で、
 * 触れる面は hitSlop で 48 まで広げる。色は弱い文字の色で、押すと白くなる。
 */
export function IconButton({
  name,
  label,
  onPress,
  disabled,
  color,
  showLabel,
  selected,
  corner,
  busy,
  large,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
  showLabel?: boolean;
  selected?: boolean;
  /** 押下面の角丸。角丸の面の内側に置くときは `concentric(外側, 余白)` を渡す。 */
  corner?: number;
  /** 処理中。アイコンの代わりに回転表示を出す（押せるまま。押すと取り消しなどに使う）。 */
  busy?: boolean;
  /** 収録画面の操作バー（見本 `.transport .ib`、44）。 */
  large?: boolean;
}) {
  const c = useAppTheme();
  const size = large ? hit.iconLarge : hit.icon;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{
        disabled: !!disabled,
        ...(selected ? { selected } : {}),
        ...(busy ? { busy } : {}),
      }}
      hitSlop={hitSlop(size)}
      style={[
        showLabel ? s.iconButtonLabeled : { width: size, height: size },
        s.iconButtonBase,
        corner === undefined ? null : { borderRadius: corner },
      ]}
    >
      {({ pressed }) => {
        const fg = disabled
          ? c.textDisabled
          : pressed
            ? c.textPrimary
            : (color ?? (selected ? c.textPrimary : c.textSecondary));
        return (
          <>
            {busy ? (
              <ActivityIndicator color={fg} />
            ) : (
              <Icon name={name} color={fg} size={icon.action} />
            )}
            {showLabel ? <Text style={[typography.overline, { color: fg }]}>{label}</Text> : null}
          </>
        );
      }}
    </Pressable>
  );
}

export type { TermInfo };

/**
 * 専門用語の横に置く ⓘ（DESIGN_SYSTEM.md §2.2、Issue #170）。押すと説明のダイアログを出す。
 * ダイアログはシートの中からでも最前面に出る（§6.3）ので、シートの中の行にも置ける。
 * 見た目は小さく、触れる面は hitSlop で 48 まで広げる。
 */
export function InfoButton({ info }: { info: TermInfo }) {
  const c = useAppTheme();
  const t = useT();
  return (
    <Pressable
      onPress={() => notify({ title: info.term, message: info.body, okLabel: t.common.close })}
      accessibilityRole="button"
      accessibilityLabel={t.glossary.a11yInfo(info.term)}
      hitSlop={hitSlop(icon.sm)}
      style={s.infoButton}
    >
      {({ pressed }) => (
        <Icon name="info" color={pressed ? c.textPrimary : c.textSecondary} size={icon.sm} />
      )}
    </Pressable>
  );
}

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  const c = useAppTheme();
  return (
    <View style={s.sectionHeader}>
      <Text
        style={[typography.title, s.flex, { color: c.textPrimary }]}
        accessibilityRole="header"
        textBreakStrategy="balanced"
      >
        {title}
      </Text>
      {right}
    </View>
  );
}

const RowCardContext = createContext(false);

export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
  raised,
  rows,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
  raised?: boolean;
  /** Row を並べるカード。押下面をカード端まで広げ、内容だけを共通余白で揃える。 */
  rows?: boolean;
}) {
  const c = useAppTheme();
  const base = raised ? c.surfaceRaised : c.surface;
  const body = (pressed: boolean) => {
    const content = (
      <View
        style={[
          s.card,
          rows ? s.rowCard : null,
          { backgroundColor: pressed ? c.surfaceHover : base },
          style,
        ]}
      >
        {children}
      </View>
    );
    return rows ? <RowCardContext.Provider value>{content}</RowCardContext.Provider> : content;
  };
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

export type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost' | 'inverse';

/**
 * ボタン（見本 `.btn`）。高さ 44 の丸い端、14 / 800。線と影は持たず、押すと少し縮む。
 * - primary: アクセントの塗りに黒の文字（見本 `.btn.pri`）
 * - secondary: 1px の輪郭だけ（見本 `.btn.sec`）。押している間は輪郭が白くなる
 * - inverse: 白の塗りに黒の文字（見本 `.btn.wht`「ここから録る」）
 * - danger: 破壊的操作の塗りに黒の文字
 * - ghost: 地も輪郭も無い
 */
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
  large,
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
  /** 画面の主操作（見本 `.ex .btn.pri`、高さ 50・15 の文字・20 のアイコン）。 */
  large?: boolean;
}) {
  const c = useAppTheme();
  const reduced = useReducedMotion();
  const off = disabled || busy;
  const [pressed, setPressed] = useState(false);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale:
          reduced || off ? 1 : withTiming(pressed ? pressScale : 1, { duration: motion.instant }),
      },
    ],
  }));
  const look = (pressed: boolean): { bg: string; border: string; fg: string } => {
    if (off) {
      return {
        bg: kind === 'ghost' || kind === 'secondary' ? 'transparent' : c.surfaceRaised,
        border: kind === 'secondary' ? c.border : 'transparent',
        fg: c.textDisabled,
      };
    }
    switch (kind) {
      case 'primary':
        return {
          bg: pressed ? c.accentSolidPressed : c.accentSolid,
          border: 'transparent',
          fg: c.accentOnSolid,
        };
      case 'danger':
        return {
          bg: pressed ? c.dangerSolidPressed : c.dangerSolid,
          border: 'transparent',
          fg: c.dangerOnSolid,
        };
      case 'inverse':
        return { bg: c.inverseSurface, border: 'transparent', fg: c.inverseText };
      case 'secondary':
        return {
          bg: 'transparent',
          border: pressed ? c.textPrimary : c.borderStrong,
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
      hitSlop={{ top: hitSlop(hit.button), bottom: hitSlop(hit.button) }}
      style={[
        s.button,
        compact ? s.buttonCompact : null,
        large ? s.buttonLarge : null,
        { backgroundColor: l.bg, borderColor: l.border },
        pressStyle,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={l.fg} />
      ) : iconName ? (
        <Icon name={iconName} color={l.fg} size={large ? icon.button : icon.sm} />
      ) : null}
      <Text
        style={[large ? typography.labelLarge : typography.label, s.buttonLabel, { color: l.fg }]}
      >
        {label}
      </Text>
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
  accessibilityActions,
  onAccessibilityAction,
  labelMuted,
  info,
}: {
  label: string;
  /** ラベルが専門用語のとき、横に ⓘ を出す。押せる行では読み上げのヒントにも説明を入れる。 */
  info?: TermInfo;
  /** 題が未設定で、代わりの文言（「タイトル未設定」）を出しているとき。弱い色にする（Issue #170）。 */
  labelMuted?: boolean;
  sub?: string;
  below?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  danger?: boolean;
  icon?: IconName;
  last?: boolean;
  accessibilityLabel?: string;
  mono?: string;
  /** 読み上げ中だけの操作（例: ドラッグの代わりの「上へ移動」）。 */
  accessibilityActions?: readonly AccessibilityActionInfo[];
  onAccessibilityAction?: (e: AccessibilityActionEvent) => void;
}) {
  const c = useAppTheme();
  const inRowCard = useContext(RowCardContext);
  const rowStyle = [s.row, inRowCard ? s.rowCardContent : null];
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
        <View style={s.rowLabel}>
          <Text
            style={[
              typography.rowTitle,
              s.rowLabelText,
              { color: danger ? c.dangerText : labelMuted ? c.textSecondary : c.textPrimary },
            ]}
          >
            {label}
          </Text>
          {info ? <InfoButton info={info} /> : null}
        </View>
        {sub ? <Text style={[typography.caption, { color: c.textSecondary }]}>{sub}</Text> : null}
        {below ? <View style={s.rowBelow}>{below}</View> : null}
      </View>
    </>
  );
  const divider = {
    borderBottomColor: c.border,
    borderBottomWidth: last ? 0 : stroke.hairline,
  };
  const a11y = accessibilityLabel ?? (sub ? `${label}, ${sub}` : label);
  const a11yActions = accessibilityActions?.length
    ? { accessibilityActions, ...(onAccessibilityAction ? { onAccessibilityAction } : {}) }
    : {};
  // 行がひとまとまりで読まれると中の ⓘ に届かないので、説明はヒントで読む。
  const a11yHint = info ? { accessibilityHint: info.body } : {};
  if (!onPress) {
    if (!accessibilityActions?.length) {
      return (
        <View style={[rowStyle, divider]}>
          {content}
          {right}
        </View>
      );
    }
    // 読み上げの操作は、読み上げが止まる要素に付ける。本文をひとまとまりにし、右の操作は外に置く。
    return (
      <View style={[s.rowOuter, divider]}>
        <View
          style={[rowStyle, s.flex]}
          accessible
          accessibilityLabel={a11y}
          {...a11yHint}
          {...a11yActions}
        >
          {content}
        </View>
        {right}
      </View>
    );
  }
  if (right) {
    // 右の操作（メニュー・ボタン・ネイティブのピッカー）は行の押下の外に置く。
    // 入れ子にすると、右を押したときに行の移動も同時に起きうる。
    return (
      <View style={[s.rowOuter, divider]}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={a11y}
          {...a11yHint}
          {...a11yActions}
          style={s.flex}
        >
          {({ pressed }) => (
            <View style={[rowStyle, { backgroundColor: pressed ? c.surfaceHover : 'transparent' }]}>
              {content}
            </View>
          )}
        </Pressable>
        {right}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      {...a11yHint}
      {...a11yActions}
    >
      {({ pressed }) => (
        <View
          style={[rowStyle, divider, { backgroundColor: pressed ? c.surfaceHover : 'transparent' }]}
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
  /** 行のラベルと同じ文言を渡す。スイッチ単体では何の切り替えか読み上げで分からない（Issue #174）。 */
  accessibilityLabel: string;
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
      accessibilityLabel={accessibilityLabel}
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
  const floating = useFloatingInset();
  const drag = useSharedValue(0);
  const keyboard = useReanimatedKeyboardAnimation();
  // 下部バーの実測高さはミニプレーヤーの分を含む。バーが無ければミニプレーヤーの上に出す
  const floor = barHeight || insets.bottom + floating;

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
          else drag.set(withSpring(0, SETTLE));
        }),
    [drag, onDismiss],
  );
  // キーボードが出ている間はその上へ持ち上げる（Issue #132）。引っ張る動きは簡略モーションでは付けない。
  const moveStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: (reduced ? 0 : drag.get()) + keyboardLift(keyboard.height.get(), floor) },
    ],
  }));

  if (!toast) return null;
  return (
    <GestureDetector gesture={pan}>
      <Reanimated.View
        key={toast.text}
        {...(reduced
          ? {}
          : {
              // 跳ねさせない（DESIGN_SYSTEM.md §2「跳ねるボタン」を排除）。入りより出を短く、どちらも ease-out。
              entering: FadeInDown.duration(motion.moderate).easing(Easing.out(Easing.cubic)),
              exiting: FadeOutDown.duration(motion.quick).easing(Easing.out(Easing.cubic)),
            })}
        onLayout={(e) => setToastHeight(e.nativeEvent.layout.height + BOTTOM_GAP)}
        style={[
          s.toast,
          {
            left: g,
            right: g,
            backgroundColor: c.inverseSurface,
            bottom: floor + BOTTOM_GAP,
          },
          moveStyle,
        ]}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        // 閉じるボタンは置かない（見本どおり。確認点 7-A、ユーザー判断 2026-10-06）。下へ払うか時間で消える。
        // 時間で消えない通知も読み上げから閉じられるように、閉じる操作を読み上げの操作に置く。
        {...(onDismiss
          ? {
              accessibilityActions: [{ name: 'dismiss', label: t.a11y.dismiss }],
              onAccessibilityAction: (e: AccessibilityActionEvent) => {
                if (e.nativeEvent.actionName === 'dismiss') onDismiss();
              },
            }
          : {})}
      >
        <Text style={[typography.bodyStrong, s.flex, { color: c.inverseText }]}>{toast.text}</Text>
        {toast.action && onAction ? (
          <Pressable
            onPress={onAction}
            accessibilityRole="button"
            accessibilityLabel={toast.action}
            hitSlop={hitSlop(typography.bodyStrong.lineHeight)}
            style={({ pressed }) => [s.toastAction, { opacity: pressed ? PRESSED_OPACITY : 1 }]}
          >
            <Text style={[typography.label, s.toastActionText, { color: c.inverseText }]}>
              {toast.action}
            </Text>
          </Pressable>
        ) : null}
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

/**
 * チップ（見本 `.chip`）。上下 7・左右 14 の丸い端、地は `surfaceRaised`、13 / 600 の白い文字。
 * 選んでいるものはアクセントの塗りに黒の文字。触れる面は hitSlop で 48 まで広げる。
 */
export function Chip({
  label,
  active,
  onPress,
  tone,
  icon: iconName,
  accessibilityLabel,
  disabled,
  raised,
}: {
  label: string;
  active?: boolean;
  /** `surfaceRaised` の面（シート）の上に置くとき。地を一段明るくする。 */
  raised?: boolean;
  onPress?: () => void;
  /** 分類の色を付けるとき（素材の種類など）。選んでいる間の地と文字に使う。 */
  tone?: { text: string; border: string; subtle: string };
  icon?: IconName;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const c = useAppTheme();
  const bg = active
    ? tone
      ? tone.subtle
      : c.accentSolid
    : raised
      ? c.surfaceHover
      : c.surfaceRaised;
  const fg = disabled
    ? c.textDisabled
    : active
      ? tone
        ? tone.text
        : c.accentOnSolid
      : c.textPrimary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      hitSlop={hitSlop(typography.chip.lineHeight + 2 * chipSize.paddingY)}
      style={({ pressed }) => [
        s.chip,
        { backgroundColor: !active && pressed ? (raised ? c.border : c.surfaceHover) : bg },
      ]}
    >
      {iconName ? <Icon name={iconName} color={fg} size={icon.sm} /> : null}
      <Text style={[typography.chip, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * 状態の札（見本 `.pill`）。角丸 4、10.5 / 700。既定は `surfaceHover` の地に弱い文字、
 * `strong` は書き出し済みなど（見本 `.pill.ok`）、`rec` は録音中（見本 `.pill.rec`、白の「REC」）。
 */
export function Pill({
  label,
  kind = 'default',
  icon: iconName,
}: {
  label: string;
  kind?: 'default' | 'strong' | 'rec';
  icon?: IconName;
}) {
  const c = useAppTheme();
  const bg = kind === 'rec' ? c.recSolid : kind === 'strong' ? c.pillStrong : c.surfaceHover;
  const fg = kind === 'rec' ? c.recOnSolid : kind === 'strong' ? c.textPrimary : c.textSecondary;
  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      {iconName ? <Icon name={iconName} color={fg} size={typography.overline.lineHeight} /> : null}
      <Text style={[typography.overline, { color: fg }]}>{label}</Text>
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
  const [trackW, setTrackW] = useState(0);
  const indeterminate = value === null;
  useEffect(() => {
    if (!indeterminate || reduced) return;
    // left ではなく transform を動かし、ネイティブ側で回す（JS が忙しい書き出し中も止まらない）。
    const loop = Animated.loop(
      Animated.timing(slide, { toValue: 1, duration: 1200, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [indeterminate, reduced, slide]);
  const pct = value === null ? null : Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <View
      style={[s.track, { backgroundColor: c.surfaceHover }]}
      onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
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
              transform: [
                {
                  translateX: reduced
                    ? trackW * 0.3
                    : slide.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-trackW * 0.4, trackW],
                      }),
                },
              ],
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
      style={[s.notice, { backgroundColor: c.surfaceRaised }]}
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
  // 通常は細い枠。入力中とエラー時だけ太くする（色だけでなく太さでも状態を示す）。
  const borderWidth = error || focused ? field.borderActive : field.border;
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
            backgroundColor: c.surfaceRaised,
            borderColor: error ? c.dangerBorder : focused ? c.focusRing : c.surfaceRaised,
            borderWidth,
          },
          fieldPadding(borderWidth),
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

/** 文字だけの操作を押している間の薄さ。 */
const PRESSED_OPACITY = pressedOpacity;
const AnimatedPressable = Reanimated.createAnimatedComponent(Pressable);
const DISMISS_DRAG = 24;
const DRAG_START = 4;
/** 引っ張ったトーストを戻すばね。臨界減衰（dampingRatio 1）で行き過ぎない。 */
const SETTLE = { dampingRatio: 1, duration: motion.moderate } as const;

const s = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  bottomBar: { paddingTop: space.md },
  iconButtonBase: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  iconButtonLabeled: {
    minWidth: hit.min,
    minHeight: hit.min,
    paddingHorizontal: space.xs,
    gap: space.xs,
  },
  // 見本 `.h2` の上は Home のまとまりの間 22、下は 12。
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.x22,
    marginBottom: space.md,
    gap: space.sm,
  },
  // カードは線も影も持たない。面の明るさだけで分ける（見本 `.checks`、DESIGN_SYSTEM.md §6）。
  card: {
    borderRadius: radius.sm,
    padding: space.x14,
    marginBottom: space.md,
  },
  rowCard: { padding: 0, overflow: 'hidden' },
  rowCardContent: { paddingHorizontal: space.x14 },
  // 見本 `.btn`: 高さ 44、丸い端、アイコンとの間 8。secondary の 1px の輪郭だけが線（§6）。
  button: {
    minHeight: hit.button,
    paddingVertical: space.sm,
    paddingHorizontal: space.x20,
    borderRadius: radius.pill,
    borderWidth: stroke.hairline,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonCompact: { paddingHorizontal: space.md },
  buttonLarge: { minHeight: hit.buttonLarge },
  buttonLabel: { textAlign: 'center', flexShrink: 1 },
  // 見本 `.field`: 上下 10、下に 1px の区切り。触れる面は 48 以上。
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: hit.min,
    paddingVertical: space.x10,
    gap: space.md,
  },
  rowOuter: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  // 話数（`#12`）は桁数で幅が変わるので、3 桁（`#999`）が入る幅にして題の行頭を揃える（Issue #170）。
  rowMono: { minWidth: space.xxxl },
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  rowLabelText: { flexShrink: 1 },
  infoButton: { alignSelf: 'center' },
  rowBelow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  // 見本 `.toast`: 白の地、角丸 8、内側 上下 12・左右 14。
  toast: {
    position: 'absolute',
    borderRadius: radius.sm,
    paddingLeft: space.x14,
    paddingRight: space.x14,
    paddingVertical: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    boxShadow: shadow.toast,
  },
  toastAction: { justifyContent: 'center' },
  toastActionText: { textDecorationLine: 'underline' },
  chip: {
    paddingVertical: chipSize.paddingY,
    paddingHorizontal: chipSize.paddingX,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: space.x6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    paddingVertical: pillSize.paddingY,
    paddingHorizontal: pillSize.paddingX,
    borderRadius: radius.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
  },
  track: { height: space.sm, borderRadius: radius.pill, overflow: 'hidden' },
  trackFill: { height: space.sm, borderRadius: radius.pill },
  indeterminate: { position: 'absolute', left: 0, width: '40%' },
  // 見本の確認用ページの通知（`.notice`）: `surfaceRaised` の地、角丸 8、内側 上下 10・左右 12。
  notice: {
    flexDirection: 'row',
    gap: space.x10,
    borderRadius: radius.sm,
    paddingVertical: space.x10,
    paddingHorizontal: space.md,
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
    minHeight: field.minHeight,
    borderRadius: field.radius,
  },
  multiline: { minHeight: field.multilineMinHeight },
  multilineLeading: { lineHeight: typography.body.lineHeight },
});

export type { TextStyle, ViewStyle };
export { Icon, type IconName } from './Icon';
export { Segmented, type SegmentedProps } from './Segmented';
export { Text, TextInput } from './Text';
export { concentric, gutter, hit, hitSlop, icon, radius, space, typography };
