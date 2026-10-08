import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';

import { IconButton, useGutter } from './components';
import { DialogHost } from './Dialog';
import { useSheetScroll } from './sheetScroll';
import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { grabber, radius, space, typography } from './tokens';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** 開いたときに中身をここまで送る（中身の上端からの距離）。null なら送らない。 */
  scrollTo?: number | null;
}

/**
 * 下から出るシート（Android と Web）。iOS は `Sheet.ios.tsx` のページシート。
 *
 * Android の Modal は別のルートに描かれるので、中身を `GestureHandlerRootView` で包まないと
 * ジェスチャー（トークテーマのドラッグなど）が届かない。ScrollView も Gesture Handler のものにして、
 * 中のドラッグが先に始まったらスクロールを止められるようにする。
 * 出典: https://docs.swmansion.com/react-native-gesture-handler/docs/fundamentals/installation
 *
 * キーボードが出たら、シートごとキーボードの上へ持ち上げる（Issue #132）。edge-to-edge では
 * `adjustResize` で画面が縮まないので、react-native-keyboard-controller の `KeyboardAvoidingView`
 * で下に余白を足す（Modal のウィンドウのキーボードも拾える）。背景が先に縮み、足りなければ
 * シート自身と中の ScrollView が縮む。入力中の欄は Android の ScrollView が見える位置へ送る。
 */
export function Sheet({ visible, onClose, title, subtitle, children, scrollTo }: SheetProps) {
  const c = useAppTheme();
  const scrollRef = useSheetScroll(visible, scrollTo);
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
      <GestureHandlerRootView style={st.root}>
        {/* シート自身が下端に safe area 分の余白を持つので、キーボードが出ている間はその分を差し引く。 */}
        <KeyboardAvoidingView
          style={st.root}
          behavior="padding"
          keyboardVerticalOffset={-insets.bottom}
        >
          <Pressable
            style={[st.backdrop, { backgroundColor: c.overlayScrim }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t.a11y.close}
          />
          <View
            style={[
              st.sheet,
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
            <ScrollView
              ref={(r) => {
                scrollRef.current = r;
              }}
              style={st.scroll}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          </View>
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
