import { Modal, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';

import { IconButton, useGutter } from './components';
import { DialogHost } from './Dialog';
import { KeyboardScroll } from './KeyboardScroll';
import type { SheetProps } from './Sheet';
import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { grabber, radius, space, typography } from './tokens';

export type { SheetProps };

/**
 * iOS はページシート（DESIGN_SYSTEM.md §6.2）。背面が縮んで奥へ下がり、下スワイプで閉じられる。
 * 閉じる操作（スワイプ・閉じるボタン）はどちらも `onClose` に集める。
 * 中身のジェスチャーとスクロールの関係は `Sheet.tsx` と揃える。
 */
export function Sheet({ visible, onClose, title, subtitle, children, onDismissed }: SheetProps) {
  const c = useAppTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const g = useGutter();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      allowSwipeDismissal
      onRequestClose={onClose}
      onDismiss={onDismissed}
    >
      <GestureHandlerRootView
        style={[st.root, { backgroundColor: c.surfaceRaised }]}
        accessibilityViewIsModal
      >
        <View style={[st.grab, { backgroundColor: c.grabber }]} />
        <View style={[st.head, { paddingLeft: g, paddingRight: g - space.xs }]}>
          <View style={st.flex}>
            {title ? (
              <Text
                style={[typography.heading, { color: c.textPrimary }]}
                accessibilityRole="header"
                // 素材名を含む題などは 2 行、副題は 1 行で省略し、全文は読み上げる（Issue #261）
                numberOfLines={2}
                accessibilityLabel={title}
              >
                {title}
              </Text>
            ) : null}
            {subtitle ? (
              <Text
                style={[typography.caption, { color: c.textSecondary }]}
                numberOfLines={1}
                accessibilityLabel={subtitle}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
          <IconButton name="close" label={t.a11y.close} onPress={onClose} />
        </View>
        {/* キーボードが出たら入力中の欄が見えるまでずらす（Issue #132、`Screen` と同じ部品）。 */}
        <KeyboardScroll
          contentContainerStyle={{ paddingHorizontal: g, paddingBottom: insets.bottom + space.xl }}
        >
          {children}
        </KeyboardScroll>
        {/* シートの中から出す確認は、ページシートの上に出す（DESIGN_SYSTEM.md §6.3）。 */}
        <DialogHost />
      </GestureHandlerRootView>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  // 見本 `.sheet .grab`。ページシートの上端に置く。
  grab: {
    alignSelf: 'center',
    width: grabber.width,
    height: grabber.height,
    borderRadius: radius.pill,
    marginTop: space.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
});
