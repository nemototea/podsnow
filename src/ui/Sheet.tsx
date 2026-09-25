import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';

import { IconButton, useGutter } from './components';
import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { radius, space, typography } from './tokens';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
}

/**
 * 下から出るシート（Android と Web）。iOS は `Sheet.ios.tsx` のページシート。
 *
 * Android の Modal は別のルートに描かれるので、中身を `GestureHandlerRootView` で包まないと
 * ジェスチャー（トークテーマのドラッグなど）が届かない。ScrollView も Gesture Handler のものにして、
 * 中のドラッグが先に始まったらスクロールを止められるようにする。
 * 出典: https://docs.swmansion.com/react-native-gesture-handler/docs/fundamentals/installation
 */
export function Sheet({ visible, onClose, title, subtitle, children }: SheetProps) {
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
      <GestureHandlerRootView style={st.root}>
        <KeyboardAvoidingView
          style={st.root}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
            <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
          </View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
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
});
