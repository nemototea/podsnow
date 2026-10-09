import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';

import { IconButton, useGutter } from './components';
import { DialogHost } from './Dialog';
import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { grabber, motion, radius, space, typography } from './tokens';
import { useReducedMotion } from './useReducedMotion';

/** 出るときは減速、引っ込むときは加速（面の大きい要素の動き）。 */
const EASE_IN = { duration: motion.moderate, easing: Easing.out(Easing.cubic) };
const EASE_OUT = { duration: motion.quick, easing: Easing.in(Easing.cubic) };

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** 閉じ終わったとき。続けて別のシートを開くときに使う（iOS は閉じ切る前に次を出せない）。 */
  onDismissed?: () => void;
}

/**
 * 下から出るシート（Android と Web）。iOS は `Sheet.ios.tsx` のページシート。
 *
 * Android の Modal は別のルートに描かれるので、中身を `GestureHandlerRootView` で包まないと
 * ジェスチャー（素材の並べ替えのドラッグなど）が届かない。ScrollView も Gesture Handler のものにして、
 * 中のドラッグが先に始まったらスクロールを止められるようにする。
 * 出典: https://docs.swmansion.com/react-native-gesture-handler/docs/fundamentals/installation
 *
 * キーボードが出たら、シートごとキーボードの上へ持ち上げる（Issue #132）。edge-to-edge では
 * `adjustResize` で画面が縮まないので、react-native-keyboard-controller の `KeyboardAvoidingView`
 * で下に余白を足す（Modal のウィンドウのキーボードも拾える）。背景が先に縮み、足りなければ
 * シート自身と中の ScrollView が縮む。入力中の欄は Android の ScrollView が見える位置へ送る。
 *
 * 出し入れは自前で動かす。Modal の `animationType="slide"` は背景の暗幕まで一緒に下から滑らせ、
 * 画面のいちばん上まで暗い面がせり上がって見えるので、暗幕はその場で薄く出し、シートだけを下から出す。
 * 閉じるときは動きが終わってから Modal を外す。
 */
export function Sheet({ visible, onClose, title, subtitle, children, onDismissed }: SheetProps) {
  const c = useAppTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const g = useGutter();
  const { height } = useWindowDimensions();
  const reduced = useReducedMotion();
  // 閉じる動きの間も Modal を出しておく。開くときは描画中に出す（effect で setState しない）
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  const progress = useSharedValue(0);
  // 閉じ切った（Modal を外した）ときに知らせる。Android と Web の Modal は外せばすぐ次を出せる
  const dismissed = useEffectEvent(() => {
    setMounted(false);
    onDismissed?.();
  });
  useEffect(() => {
    if (!mounted) return;
    const fast = { duration: motion.instant };
    if (visible) {
      progress.value = withTiming(1, reduced ? fast : EASE_IN);
      return;
    }
    progress.value = withTiming(0, reduced ? fast : EASE_OUT, (finished) => {
      if (finished) runOnJS(dismissed)();
    });
  }, [mounted, progress, reduced, visible]);
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() =>
    reduced
      ? { opacity: progress.value }
      : { transform: [{ translateY: (1 - progress.value) * height }] },
  );
  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <GestureHandlerRootView style={st.root}>
        {/* 暗幕は画面全体に敷き、その場で薄く出す（シートと一緒に滑らせない） */}
        <Animated.View style={[StyleSheet.absoluteFill, scrimStyle]}>
          <Pressable
            style={[st.root, { backgroundColor: c.overlayScrim }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t.a11y.close}
          />
        </Animated.View>
        {/* シート自身が下端に safe area 分の余白を持つので、キーボードが出ている間はその分を差し引く。 */}
        <KeyboardAvoidingView
          style={st.root}
          pointerEvents="box-none"
          behavior="padding"
          keyboardVerticalOffset={-insets.bottom}
        >
          <View style={st.backdrop} pointerEvents="none" />
          <Animated.View
            style={[
              st.sheet,
              sheetStyle,
              {
                backgroundColor: c.surfaceRaised,
                paddingHorizontal: g,
                paddingBottom: insets.bottom + space.lg,
                maxHeight: height * 0.88,
              },
            ]}
            accessibilityViewIsModal
          >
            <View style={[st.grab, { backgroundColor: c.grabber }]} />
            <View style={st.sheetHead}>
              <View style={st.flex}>
                {title ? (
                  <Text
                    style={[typography.heading, { color: c.textPrimary }]}
                    accessibilityRole="header"
                    textBreakStrategy="balanced"
                  >
                    {title}
                  </Text>
                ) : null}
                {subtitle ? (
                  <Text style={[typography.caption, { color: c.textSecondary }]}>{subtitle}</Text>
                ) : null}
              </View>
              <View style={st.sheetClose}>
                <IconButton name="close" label={t.a11y.close} onPress={onClose} />
              </View>
            </View>
            <ScrollView style={st.scroll} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
        {/* シートの中から出す確認は、シートの上に出す（DESIGN_SYSTEM.md §6.3）。 */}
        <DialogHost />
      </GestureHandlerRootView>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  backdrop: { flex: 1 },
  scroll: { flexShrink: 1 },
  sheet: {
    flexShrink: 1,
    // 見本 `.sheet`: 上辺の角丸 14、内側の上 12、つまみ 36×4。
    borderTopLeftRadius: radius.x14,
    borderTopRightRadius: radius.x14,
    paddingTop: space.md,
    gap: space.md,
  },
  grab: {
    alignSelf: 'center',
    width: grabber.width,
    height: grabber.height,
    borderRadius: radius.pill,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingTop: space.xs,
  },
  sheetClose: { marginRight: -space.xs },
});
