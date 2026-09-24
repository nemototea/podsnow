import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';

import { IconButton, useGutter } from './components';
import type { SheetProps } from './Sheet';
import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { space, typography } from './tokens';

export type { SheetProps };

/**
 * iOS はページシート（DESIGN_SYSTEM.md §6.2）。背面が縮んで奥へ下がり、下スワイプで閉じられる。
 * 閉じる操作（スワイプ・閉じるボタン）はどちらも `onClose` に集める。
 */
export function Sheet({ visible, onClose, title, subtitle, children }: SheetProps) {
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
    >
      <View style={[st.root, { backgroundColor: c.surfaceRaised }]} accessibilityViewIsModal>
        <View style={[st.head, { paddingLeft: g, paddingRight: g - space.md }]}>
          <View style={st.flex}>
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
          <IconButton name="close" label={t.a11y.close} onPress={onClose} />
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ paddingHorizontal: g, paddingBottom: insets.bottom + space.xl }}
        >
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
});
