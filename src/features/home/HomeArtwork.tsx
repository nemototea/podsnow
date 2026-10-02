import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { useGutter } from '@/ui/components';
import { Jacket, jacketWidth } from '@/ui/media';
import { artwork, space } from '@/ui/tokens';

/**
 * Home の番組アートワーク（DESIGN_SYSTEM.md §2.6、§8、#190）。レコードジャケットに入れ（#203）、
 * 書き出したファイルや配信中の音声を再生している間だけ盤を回す。画像の上には何も重ねない。
 * #133 の幅いっぱいのフェードはやめた。
 */
export function HomeArtwork({ uri, playing }: { uri: string; playing: boolean }) {
  const { width } = useWindowDimensions();
  const gutter = useGutter();
  const room = width - gutter * 2;
  const size = Math.min(artwork.homeJacket, Math.floor(room / jacketWidth(1)));
  return (
    <View
      style={s.frame}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Jacket uri={uri} size={size} playing={playing} />
    </View>
  );
}

const s = StyleSheet.create({
  frame: { marginTop: space.lg, marginBottom: space.sm },
});
