import { useEffect, useState, useSyncExternalStore } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Button, useGutter } from './components';
import { dialogs, type DialogEntry } from './dialogStore';
import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { dialogWidth, radius, space, stroke, typography } from './tokens';
import { useReducedMotion } from './useReducedMotion';

/** 文字をこれより大きくする設定では、ボタンを横に並べず縦に積む。 */
const STACK_FONT_SCALE = 1.3;

/**
 * 確認・エラー・問いかけのダイアログの表示先（DESIGN_SYSTEM.md §6.3）。
 *
 * ルート（`_layout.tsx`）と各 `Sheet` の中に置く。一番新しく登録されたホストだけが描く
 * （iOS の Modal は一番近いビューコントローラから出るので、シートの上にはシートの中から出す）。
 * 次の要求が続くあいだは Modal を閉じずに中身だけ入れ替える。
 */
export function DialogHost() {
  const c = useAppTheme();
  const reduced = useReducedMotion();
  const g = useGutter();
  const { width, fontScale } = useWindowDimensions();
  const snap = useSyncExternalStore(dialogs.subscribe, dialogs.getSnapshot);
  const [hostId] = useState(dialogs.hostId);
  useEffect(() => dialogs.register(hostId), [hostId]);

  const mine = snap.host === hostId ? snap.current : null;
  // 閉じるフェードのあいだも中身を残す。
  const [last, setLast] = useState<DialogEntry | null>(null);
  if (mine && mine !== last) setLast(mine);
  const shown = mine ?? last;

  const answer = (confirmed: boolean) => {
    if (mine) dialogs.resolve(mine.id, confirmed);
  };
  const stacked = fontScale >= STACK_FONT_SCALE;

  return (
    <Modal
      visible={!!mine}
      transparent
      animationType={reduced ? 'none' : 'fade'}
      onRequestClose={() => answer(false)}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <GestureHandlerRootView style={st.root}>
        <View style={[st.center, { paddingHorizontal: g }]}>
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: c.overlayScrim }]}
            onPress={() => answer(false)}
            // 読み上げではキャンセルのボタンを使う。背景は触れる対象にしない。
            accessible={false}
            importantForAccessibility="no"
          />
          {shown ? (
            <View
              style={[
                st.card,
                {
                  backgroundColor: c.surfaceRaised,
                  borderColor: c.border,
                  width: Math.min(width - g * 2, dialogWidth),
                },
              ]}
              accessibilityViewIsModal
            >
              <Text
                style={[typography.heading, { color: c.textPrimary }]}
                accessibilityRole="header"
                textBreakStrategy="balanced"
              >
                {shown.title}
              </Text>
              {shown.message ? (
                <Text style={[typography.body, { color: c.textSecondary }]}>{shown.message}</Text>
              ) : null}
              <View style={[st.actions, stacked ? st.actionsStacked : null]}>
                {shown.cancelLabel !== undefined ? (
                  <Button
                    label={shown.cancelLabel}
                    kind="secondary"
                    onPress={() => answer(false)}
                    style={stacked ? null : st.flex}
                  />
                ) : null}
                <Button
                  label={shown.confirmLabel}
                  kind={shown.tone}
                  onPress={() => answer(true)}
                  style={stacked ? null : st.flex}
                />
              </View>
            </View>
          ) : null}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // シートの上に出ても面が溶けないよう、輪郭を 1 周引く。
  card: {
    borderRadius: radius.xl,
    borderWidth: stroke.hairline,
    padding: space.xl,
    gap: space.sm,
  },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  // 縦に積むときは実行を上、キャンセルを下（親指に近い側）に置く。
  actionsStacked: { flexDirection: 'column-reverse' },
});
