import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { Artwork } from '../Artwork';
import { useAppTheme } from '../ThemeContext';
import { buttonDepth, radius, spin, stroke } from '../tokens';
import { SpinView, useSpin } from './useSpin';

/** ディスクの直径（ジャケットに対する比）と、右からのぞく割合。 */
const DISC = 0.92;
const PEEK = 0.45;
const HINGE = 0.05;
const HINGE_PITCH = 7;

/** ジャケットの `size` から、ディスクまで含めた幅。 */
export function jacketWidth(size: number): number {
  return size + size * DISC * PEEK;
}

/**
 * 番組アートワークの CD ジャケット（DESIGN_SYSTEM.md §2.6）。書き出したファイルや配信中の音声を
 * 再生しているときは、右からのぞくディスクが回る。画像の上には文字も飾りも重ねない。
 */
export function Jacket({
  uri,
  size,
  playing = false,
  label,
}: {
  uri: string | null;
  size: number;
  playing?: boolean;
  /** 読み上げ用。飾りなら省く */
  label?: string;
}) {
  const c = useAppTheme();
  const spinStyle = useSpin(playing, spin.disc);
  const disc = size * DISC;
  const hinge = Math.max(stroke.selected * 2, Math.round(size * HINGE));
  const inner = size - stroke.selected * 2 - hinge;
  const stripes = Math.floor(size / HINGE_PITCH);
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
          <Circle
            cx={100}
            cy={100}
            r={98}
            fill={c.surfaceRaised}
            stroke={c.controlBorder}
            strokeWidth={3}
          />
          <Circle cx={100} cy={100} r={88} fill="none" stroke={c.border} strokeWidth={1.5} />
          <Circle cx={100} cy={100} r={80} fill="none" stroke={c.border} strokeWidth={1.5} />
          <Path
            d="M100 30 A70 70 0 0 1 170 100 L100 100 Z"
            fill={c.brandShadow}
            stroke={c.controlBorder}
            strokeWidth={2}
          />
          <Path
            d="M100 170 A70 70 0 0 1 30 100 L100 100 Z"
            fill={c.brandAccent}
            stroke={c.controlBorder}
            strokeWidth={2}
          />
          <Circle cx={100} cy={100} r={70} fill="none" stroke={c.controlBorder} strokeWidth={2} />
          <Circle
            cx={100}
            cy={100}
            r={26}
            fill={c.surfaceRaised}
            stroke={c.controlBorder}
            strokeWidth={2}
          />
          <Circle cx={100} cy={100} r={10} fill={c.bg} stroke={c.controlBorder} strokeWidth={2} />
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
          <View style={[s.hinge, { width: hinge, borderColor: c.controlBorder }]}>
            <Svg width={hinge} height={size}>
              {Array.from({ length: stripes }, (_, i) => (
                <Line
                  key={i}
                  x1={0}
                  x2={hinge}
                  y1={i * HINGE_PITCH + 1}
                  y2={i * HINGE_PITCH + 1}
                  stroke={c.controlBorder}
                  strokeWidth={stroke.selected}
                />
              ))}
            </Svg>
          </View>
          <Artwork uri={uri} size={inner} frameless {...(label ? { label } : {})} />
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
    flexDirection: 'row',
    borderWidth: stroke.selected,
    borderRadius: radius.xs,
    overflow: 'hidden',
  },
  hinge: { borderRightWidth: stroke.selected, overflow: 'hidden' },
});
