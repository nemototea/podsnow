import { Pressable, StyleSheet, View } from 'react-native';

import { useT } from '@/i18n';
import { Text } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { hitSlop, pressedOpacity, radius, space, stroke, typography } from '@/ui/tokens';

/**
 * コピーの行（見本 `.field` / `.copybtn`）。上に小さい名前、下に値（1 行で省略）、右に丸い端の「コピー」。
 * コピーできたらアクセントの塗りの「コピー済み」になる（書き込みが成功してから。DESIGN_SYSTEM.md §8）。
 * `onEdit` があれば、行を押すとその項目を直せる（書き出しタブ）。
 * `onCopy` が無ければ「コピー」を置かない（「その他の詳細」のように、項目ごとに入れる値。Issue #211）。
 */
export function CopyRow({
  label,
  value,
  copied,
  onCopy,
  onEdit,
  editLabel,
}: {
  label: string;
  value: string;
  copied?: boolean;
  onCopy?: () => void;
  onEdit?: () => void;
  /** 行を押したときの読み上げ（「タイトルを編集」）。 */
  editLabel?: string;
}) {
  const c = useAppTheme();
  const t = useT();
  const body = (
    <>
      <Text style={[typography.fieldLabel, { color: c.textSecondary }]}>{label}</Text>
      <Text
        style={[typography.rowTitle, { color: value ? c.textPrimary : c.textTertiary }]}
        numberOfLines={1}
      >
        {value || t.common.empty}
      </Text>
    </>
  );
  return (
    <View style={[s.field, { borderBottomColor: c.border }]}>
      {onEdit ? (
        <Pressable
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel={`${editLabel ?? label}, ${value || t.common.empty}`}
          style={({ pressed }) => [s.text, pressed ? { opacity: pressedOpacity } : null]}
        >
          {body}
        </Pressable>
      ) : (
        <View style={s.text} accessible>
          {body}
        </View>
      )}
      {onCopy ? (
        <Pressable
          onPress={onCopy}
          disabled={!value}
          accessibilityRole="button"
          accessibilityLabel={copied ? t.pack.a11yCopied(label) : t.pack.a11yCopy(label)}
          accessibilityState={{ disabled: !value }}
          hitSlop={hitSlop(typography.smallStrong.lineHeight + space.x6 * 2)}
          style={({ pressed }) => [
            s.copy,
            copied
              ? { backgroundColor: c.accentSolid, borderColor: c.accentSolid }
              : { borderColor: pressed ? c.textPrimary : c.borderStrong },
          ]}
        >
          <Text
            style={[
              typography.smallStrong,
              { color: !value ? c.textDisabled : copied ? c.accentOnSolid : c.textPrimary },
            ]}
          >
            {copied ? t.common.copied : t.common.copy}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  // 見本 `.field`: 上下 10、間 12、下端に線。
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.x10,
    borderBottomWidth: stroke.hairline,
  },
  text: { flex: 1, minWidth: 0, gap: space.hair },
  // 見本 `.copybtn`: 上下 6・左右 12、丸い端、1 の輪郭。
  copy: {
    paddingVertical: space.x6,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: stroke.hairline,
  },
});
