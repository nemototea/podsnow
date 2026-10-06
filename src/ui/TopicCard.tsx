import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from './Icon';
import { compositeHex } from './showColors';
import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { radius, space, typography } from './tokens';

/**
 * 補助文字の白の濃さ（見本 `.topic small` 85%、`.topic .next` 80%）。
 * 番組の色によっては 4.5:1 を割る。DESIGN_SYSTEM.md §13 で確認中（決まったら変える）。
 */
const META_ALPHA = 0.85;
const NEXT_ALPHA = 0.8;

/**
 * トークテーマのカード（見本 `.topic`、DESIGN_SYSTEM.md §2.7）。塗りは番組の色（`topicCard`）、文字は白。
 * 押すと全体のシートを開く（見るだけで話題は進まない）。文言は呼び出し側が渡す。
 */
export function TopicCard({
  color,
  heading,
  counter,
  title,
  next,
  onPress,
  accessibilityLabel,
}: {
  /** 番組の色の `topicCard`（`deriveShowColors`）。 */
  color: string;
  /** 上段の左（「トークテーマ」）。 */
  heading: string;
  /** 上段の右（「2 / 5」）。 */
  counter?: string | undefined;
  /** 今の項目の名前。 */
  title: string;
  /** 下段（「次へ送るとチャプターになります: …」）。 */
  next?: string | undefined;
  onPress?: () => void;
  accessibilityLabel: string;
}) {
  const c = useAppTheme();
  const meta = compositeHex(c.textPrimary, META_ALPHA, color);
  const sub = compositeHex(c.textPrimary, NEXT_ALPHA, color);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      style={[s.card, { backgroundColor: color }]}
    >
      <View style={s.top}>
        <Text style={[typography.meta, { color: meta }]}>{heading}</Text>
        {counter ? <Text style={[typography.meta, { color: meta }]}>{counter}</Text> : null}
      </View>
      <Text style={[typography.topic, { color: c.textPrimary }]}>{title}</Text>
      {next ? (
        <View style={s.next}>
          <Icon name="nextTopic" color={sub} size={typography.caption.fontSize} />
          <Text style={[typography.caption, s.flex, { color: sub }]}>{next}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  // 見本 `.topic`: 角丸 10、内側 上 14・左右 14・下 12、行の間 8。
  card: {
    borderRadius: radius.x10,
    paddingTop: space.x14,
    paddingHorizontal: space.x14,
    paddingBottom: space.md,
    gap: space.sm,
  },
  top: { flexDirection: 'row', justifyContent: 'space-between' },
  next: { flexDirection: 'row', alignItems: 'center', gap: space.x6 },
  flex: { flex: 1 },
});
