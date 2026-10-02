import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { Artwork } from '../Artwork';
import { useAppTheme } from '../ThemeContext';
import { buttonDepth, colors, radius, spin, stroke } from '../tokens';
import { SpinView, useSpin } from './useSpin';

/** 盤の直径（ジャケットに対する比）と、右からのぞく割合。 */
const DISC = 0.92;
const PEEK = 0.45;
/** 盤の溝とレーベルの半径（viewBox 200 のとき）。64〜74 の間は曲間の空き。 */
const GROOVES = [90, 82, 74, 64, 56, 46];
const LABEL = 36;

/** ジャケットの `size` から、盤まで含めた幅。 */
export function jacketWidth(size: number): number {
  return size + size * DISC * PEEK;
}

/**
 * 番組アートワークのレコードジャケット（DESIGN_SYSTEM.md §2.6、Issue #203）。書き出したファイルや
 * 配信中の音声を再生しているときは、右からのぞく盤が回る。回転の目印はレーベルのピンクの帯。
 * 画像の上には文字も飾りも重ねない。
 */
export function Jacket({
  uri,
  size,
  playing = false,
  label,
  name,
}: {
  uri: string | null;
  /** 画像が無いときの表紙に組む番組名（§2.6、Issue #193）。 */
  name?: string | undefined;
  size: number;
  playing?: boolean;
  /** 読み上げ用。飾りなら省く */
  label?: string;
}) {
  const c = useAppTheme();
  const spinStyle = useSpin(playing, spin.disc);
  const disc = size * DISC;
  const inner = size - stroke.selected * 2;
  // 盤はカセットのテープと同じく、テーマによらず墨
  const ink = colors.light.textPrimary;
  const groove = colors.dark.border;
  return (
    <View style={{ width: jacketWidth(size), height: size }}>
      <SpinView
        style={[
          s.disc,
          { left: size - disc * (1 - PEEK), top: (size - disc) / 2, width: disc, height: disc },
          spinStyle,
        ]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Svg width={disc} height={disc} viewBox="0 0 200 200">
          <Circle cx={100} cy={100} r={98} fill={ink} stroke={c.controlBorder} strokeWidth={3} />
          {GROOVES.map((r) => (
            <Circle key={r} cx={100} cy={100} r={r} fill="none" stroke={groove} strokeWidth={1.5} />
          ))}
          <Circle cx={100} cy={100} r={LABEL} fill={c.brandAccent} />
          <Path
            d="M64.9 108 L135.1 108 A36 36 0 0 1 131.2 118 L68.8 118 A36 36 0 0 1 64.9 108 Z"
            fill={c.brandShadow}
          />
          <Circle cx={100} cy={100} r={LABEL} fill="none" stroke={ink} strokeWidth={2} />
          <Circle cx={100} cy={100} r={5} fill={c.bg} stroke={ink} strokeWidth={1.5} />
        </Svg>
      </SpinView>
      <View
        style={[
          s.case,
          {
            width: size,
            height: size,
            boxShadow: [
              {
                offsetX: buttonDepth.offsetLarge,
                offsetY: buttonDepth.offsetLarge,
                blurRadius: 0,
                color: c.controlShadow,
              },
            ],
          },
        ]}
      >
        <View style={[s.inner, { borderColor: c.controlBorder, backgroundColor: c.surface }]}>
          <Artwork uri={uri} name={name} size={inner} frameless {...(label ? { label } : {})} />
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  disc: { position: 'absolute' },
  case: { position: 'absolute', left: 0, top: 0, borderRadius: radius.xs },
  inner: {
    flex: 1,
    borderWidth: stroke.selected,
    borderRadius: radius.xs,
    overflow: 'hidden',
  },
});
