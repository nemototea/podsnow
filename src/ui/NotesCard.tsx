import { ScrollView, StyleSheet, View } from 'react-native';

import { compositeHex } from '@/domain/color/showColors';
import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { radius, recordView, space, typography } from './tokens';

/**
 * 上段の「カンペ」の白の濃さ（見本 `.cue small` 85%）。番組の色（`notesCard`）は
 * 80% の白を重ねても 4.5:1 になるまで暗くしてあるので、85% はそれを満たす（確認点 6-D、`showColors.ts`）。
 */
const META_ALPHA = 0.85;

/**
 * 録音中のカンペのカード（見本 `.cue`、DESIGN_SYSTEM.md §2.7、Issue #180）。
 * 塗りは番組の色（`notesCard`）、文字は白。**読むだけ**で、押しても何も開かない。
 * 残りの高さをすべて使い、はみ出した分はカードの中を指でスクロールする（自動では送らない）。
 * 外側も縦にスクロールする画面に置くので、Android でも中が動くように入れ子のスクロールを許す。
 * 文言は呼び出し側が渡す。
 */
export function NotesCard({
  color,
  heading,
  body,
}: {
  /** 番組の色の `notesCard`（`deriveShowColors`）。 */
  color: string;
  /** 上段（「カンペ」）。 */
  heading: string;
  /** カンペの本文。改行をそのまま見せる。 */
  body: string;
}) {
  const c = useAppTheme();
  const meta = compositeHex(c.textPrimary, META_ALPHA, color);
  return (
    <View
      accessible
      accessibilityLabel={`${heading}, ${body}`}
      style={[s.card, { backgroundColor: color }]}
    >
      <Text style={[typography.meta, { color: meta }]}>{heading}</Text>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        <Text style={[typography.notes, { color: c.textPrimary }]}>{body}</Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  // 見本 `.cue`: 角丸 10、内側 上 14・左右 14、行の間 8。下の余白は本文の側に置き、
  // スクロールしたときに本文がカードの下端まで流れるようにする。
  card: {
    flex: 1,
    minHeight: recordView.notesMin,
    borderRadius: radius.x10,
    paddingTop: space.x14,
    paddingHorizontal: space.x14,
    gap: space.sm,
  },
  scroll: { flex: 1 },
  content: { paddingBottom: space.x14 },
});
