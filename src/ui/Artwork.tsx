import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { Icon } from './Icon';
import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { icon, radius, shadow as shadows, space } from './tokens';

/** 番組名を載せる最小の辺。これより小さいと読めないので、面だけにする。 */
const NAME_MIN = 48;
/** これより大きければ番組名を極太（900）で組む。小さいときは 800（見本 `.art.small span`）。 */
const HEAVY_MIN = 96;
/** 番組名の字の大きさと内側の余白（辺に対する割合。見本の番組画面のアートワーク 196px で 28px / 14px）。 */
const NAME_RATIO = 0.143;
const PAD_RATIO = 0.0714;
/** 字の大きさの下限（見本 `.art.small span` の 9px）。 */
const NAME_FONT_MIN = 9;

/**
 * 画像が無いときの番組の表紙（DESIGN_SYSTEM.md §2.6、Issue #193 / #235）。
 * `surfaceRaised` の正方形の左下に、番組名を白の極太で置く（見本のアートワークの文字の置き方）。
 * 画面の中の目印だけに使い、書き出すファイルには埋め込まない。
 */
function NameCover({ name, size }: { name: string; size: number }) {
  const c = useAppTheme();
  if (size < NAME_MIN) return null;
  const fontSize = Math.max(NAME_FONT_MIN, Math.round(size * NAME_RATIO));
  return (
    <View style={[s.cover, { padding: Math.max(space.x6, Math.round(size * PAD_RATIO)) }]}>
      <Text
        numberOfLines={3}
        style={{
          color: c.textPrimary,
          fontSize,
          lineHeight: Math.round(fontSize * 1.08),
          fontWeight: size >= HEAVY_MIN ? '900' : '800',
          letterSpacing: -fontSize * 0.02,
        }}
      >
        {name}
      </Text>
    </View>
  );
}

/**
 * 番組・回のアートワーク（Issue #101 / #235）。正方形、角丸 4（見本 `.art`）。線は持たない。
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
  shadow,
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
  /** 角丸を持たない（移行用: Design system 3 のレコードジャケットの中に置くとき）。 */
  frameless?: boolean;
  /** 落ち影（見本 `.showcard .art` / `.showhead .art`）。大きい表示だけに付ける。 */
  shadow?: 'card' | 'large';
}) {
  const c = useAppTheme();
  const [failed, setFailed] = useState<string | null>(null);
  const corner = frameless ? 0 : radius.xs;
  const outer = [
    { width: size, height: size, borderRadius: corner },
    shadow ? { boxShadow: shadow === 'large' ? shadows.artworkLarge : shadows.artworkCard } : null,
  ];
  const box = [
    s.box,
    { width: size, height: size, borderRadius: corner, backgroundColor: c.surfaceRaised },
  ];
  const a11y = label
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label }
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };
  let content;
  if ((!uri || failed === uri) && name?.trim()) {
    content = <NameCover name={name.trim()} size={size} />;
  } else if (!uri || failed === uri) {
    content = (
      <View style={[s.fill, s.center]}>
        <Icon name="artwork" color={c.textTertiary} size={size >= HEAVY_MIN ? icon.lg : icon.sm} />
      </View>
    );
  } else {
    content = (
      <Image
        source={uri}
        style={{ width: size, height: size }}
        contentFit="cover"
        transition={transition}
        onError={() => setFailed(uri)}
      />
    );
  }
  return (
    <View style={outer} {...a11y}>
      <View style={box}>{content}</View>
    </View>
  );
}

const s = StyleSheet.create({
  box: { overflow: 'hidden' },
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  cover: { flex: 1, justifyContent: 'flex-end' },
});
