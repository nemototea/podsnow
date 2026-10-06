import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { Icon } from './Icon';
import { Halftone } from './media/Halftone';
import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { icon, radius, space, stroke, typography } from './tokens';

/** 番組名を載せる最小の辺。これより小さいと読めないので、点だけにする。 */
const NAME_MIN = 96;
/** これより大きければ番組名を `display` で組む。 */
const DISPLAY_MIN = 160;
/** 網点を描く最小の辺（DESIGN_SYSTEM.md §2.5、60px 以下には描かない）。 */
const HALFTONE_MIN = 61;

/**
 * 画像が無いときの番組の表紙（DESIGN_SYSTEM.md §2.6、Issue #193）。地はカセットの殻と同じ網点で、
 * 番組名は紙のラベルに墨で書く（網点を文字の下に置かない）。小さいときは点だけ。
 * 画面の中の再生の目印だけに使い、書き出すファイルには埋め込まない。
 */
function NameCover({ name, size }: { name: string; size: number }) {
  const c = useAppTheme();
  // カセットのラベルと同じく、紙と墨はテーマによらない
  const paper = c.sketchPaper;
  const ink = c.sketchInk;
  const large = size >= DISPLAY_MIN;
  const dot = large ? space.md : size >= NAME_MIN ? space.sm : space.xs + space.hair;
  return (
    <View
      style={[
        s.cover,
        { padding: large ? space.md : space.sm },
        { backgroundColor: c.surfaceRaised },
      ]}
    >
      {size >= HALFTONE_MIN ? <Halftone color={c.halftone} /> : null}
      {size >= NAME_MIN ? (
        <View
          style={[s.label, { backgroundColor: paper, borderColor: ink, borderRadius: radius.sm }]}
        >
          <Text
            numberOfLines={3}
            style={[
              large ? typography.display : typography.sign,
              s.name,
              { color: ink, padding: large ? space.md : space.sm },
            ]}
          >
            {name}
          </Text>
          <View style={s.stripes}>
            <View style={[s.stripe, { backgroundColor: c.brandShadow }]} />
            <View style={[s.stripe, { backgroundColor: c.brandAccent }]} />
          </View>
        </View>
      ) : (
        <View
          style={[
            s.dot,
            {
              width: dot,
              height: dot,
              borderRadius: dot / 4,
              backgroundColor: c.brandAccent,
              borderColor: ink,
            },
          ]}
        />
      )}
    </View>
  );
}

/**
 * 番組・回のアートワーク（Issue #101）。正方形。
 * 画像が無い・読めないときは、`name` があれば番組名の表紙、無ければ番組のアイコンを置いた面にする
 * （レイアウトを崩さない）。
 */
export function Artwork({
  uri,
  size,
  label,
  name,
  transition = 0,
  frameless,
}: {
  /** `https://` または `file://` */
  uri: string | null;
  size: number;
  /** 読み上げ用。飾りなら省く */
  label?: string;
  /** 画像が無いときに表紙に組む番組名。画像を選ぶ画面（番組の設定・取り込み）では渡さない。 */
  name?: string | undefined;
  /** 画像の入れ替え時間。動きを減らすときは 0。 */
  transition?: number;
  /** 枠と角丸を持たない（レコードジャケットの中に置くとき。#190、#203）。 */
  frameless?: boolean;
}) {
  const c = useAppTheme();
  const [failed, setFailed] = useState<string | null>(null);
  const corner = frameless ? 0 : size >= 96 ? radius.lg : radius.sm;
  const box = [
    s.box,
    {
      width: size,
      height: size,
      borderRadius: corner,
      borderWidth: frameless ? 0 : stroke.hairline,
      backgroundColor: c.surfaceRaised,
      borderColor: c.border,
    },
  ];
  const a11y = label
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label }
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };
  if ((!uri || failed === uri) && name?.trim()) {
    return (
      <View style={box} {...a11y}>
        <NameCover name={name.trim()} size={size} />
      </View>
    );
  }
  if (!uri || failed === uri) {
    return (
      <View style={[box, s.center]} {...a11y}>
        <Icon name="artwork" color={c.textTertiary} size={size >= 96 ? icon.lg : icon.sm} />
      </View>
    );
  }
  return (
    <View style={box} {...a11y}>
      <Image
        source={uri}
        style={{ width: size, height: size }}
        contentFit="cover"
        transition={transition}
        onError={() => setFailed(uri)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  box: { overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  cover: { flex: 1, justifyContent: 'center' },
  label: { borderWidth: stroke.selected, overflow: 'hidden' },
  name: { textAlign: 'center' },
  stripes: { flexDirection: 'row', height: space.sm },
  stripe: { flex: 1 },
  // 文字の無い小さい表紙でも、点はロゴと同じ右下に置く
  dot: { position: 'absolute', right: space.sm, bottom: space.sm, borderWidth: stroke.hairline },
});
