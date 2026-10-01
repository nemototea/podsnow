import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { useT } from '@/i18n';

import { Text } from '../Text';
import { useAppTheme } from '../ThemeContext';
import { buttonDepth, colors, space, spin, stroke, typography } from '../tokens';
import { packRadius } from './geometry';
import { Halftone } from './Halftone';
import { SpinView, useSpin } from './useSpin';

/** 原寸の設計（px）。`width` に合わせて全体を拡大縮小する。 */
const W = 358;
const H = 226;
const LABEL = { x: 18, y: 14, w: 322, h: 128 };
const WINDOW = { x: 69, y: 66, w: 220, h: 62 };
const REEL = { l: 117, r: 241, y: 97, hub: 11 };
const SCREWS = [
  [12, 12],
  [346, 12],
  [12, 214],
  [346, 214],
] as const;

/**
 * 編集中のタイムラインの見立て（DESIGN_SYSTEM.md §2.6、`PlaybackSource.kind === 'timeline'`）。
 * リールは再生中だけ回り、再生位置に合わせてテープが左から右へ移る。
 */
export function Cassette({
  width,
  progress,
  playing,
  title,
  code,
}: {
  width: number;
  /** 0〜1。再生位置 ÷ 全体。 */
  progress: number;
  playing: boolean;
  title: string;
  code: string | null;
}) {
  const c = useAppTheme();
  const t = useT();
  const paper = colors.light.bg;
  const ink = colors.light.textPrimary;
  const k = width / W;
  const spinStyle = useSpin(playing, spin.reel);
  const left = packRadius(1 - progress);
  const right = packRadius(progress);
  const hub = REEL.hub * 2 * k;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t.player.tape}
      style={[
        { width, height: H * k, borderRadius: 16 * k },
        {
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
      <View
        style={[
          s.shell,
          {
            borderRadius: 16 * k,
            borderColor: c.controlBorder,
            backgroundColor: c.isDark ? c.surfaceRaised : c.accentSolid,
          },
        ]}
      >
        <Halftone color={c.isDark ? c.halftone : c.accentSolidPressed} />
        <Svg width={width} height={H * k} viewBox={`0 0 ${W} ${H}`} style={StyleSheet.absoluteFill}>
          {SCREWS.map(([x, y]) => (
            <Circle
              key={`${x}-${y}`}
              cx={x}
              cy={y}
              r={4}
              fill={paper}
              stroke={ink}
              strokeWidth={2}
            />
          ))}
          <Rect {...rect(LABEL)} rx={8} fill={paper} stroke={ink} strokeWidth={2} />
          <Rect
            x={LABEL.x + 1}
            y={LABEL.y + 34}
            width={LABEL.w / 2 - 1}
            height={7}
            fill={c.brandShadow}
          />
          <Rect
            x={LABEL.x + LABEL.w / 2}
            y={LABEL.y + 34}
            width={LABEL.w / 2 - 1}
            height={7}
            fill={c.brandAccent}
          />
          <Rect
            {...rect(WINDOW)}
            rx={WINDOW.h / 2}
            fill={colors.light.surfaceHover}
            stroke={ink}
            strokeWidth={2}
          />
          <Circle cx={REEL.l} cy={REEL.y} r={left} fill={ink} />
          <Circle cx={REEL.r} cy={REEL.y} r={right} fill={ink} />
          <Path
            d={`M${REEL.l} ${REEL.y + left} L${REEL.r} ${REEL.y + right}`}
            stroke={ink}
            strokeWidth={2}
          />
          <Path
            d="M62 225 L83 174 Q85 168 91 168 L267 168 Q273 168 275 174 L296 225"
            fill={c.isDark ? c.surface : c.accentSolidPressed}
            stroke={c.controlBorder}
            strokeWidth={2}
          />
          <Circle cx={118} cy={200} r={7} fill={c.bg} stroke={c.controlBorder} strokeWidth={2} />
          <Circle cx={240} cy={200} r={7} fill={c.bg} stroke={c.controlBorder} strokeWidth={2} />
        </Svg>
        {[REEL.l, REEL.r].map((x) => (
          <SpinView
            key={x}
            style={[
              s.reel,
              { left: (x - REEL.hub) * k, top: (REEL.y - REEL.hub) * k, width: hub, height: hub },
              spinStyle,
            ]}
          >
            <Svg width={hub} height={hub} viewBox="0 0 22 22">
              <Circle cx={11} cy={11} r={10} fill={paper} stroke={ink} strokeWidth={2} />
              <Rect x={9.5} y={1} width={3} height={5} fill={ink} />
              <Rect x={9.5} y={16} width={3} height={5} fill={ink} />
              <Rect x={1} y={9.5} width={5} height={3} fill={ink} />
              <Rect x={16} y={9.5} width={5} height={3} fill={ink} />
            </Svg>
          </SpinView>
        ))}
        <View
          style={[
            s.labelRow,
            {
              left: (LABEL.x + 10) * k,
              right: (W - LABEL.x - LABEL.w + 10) * k,
              top: (LABEL.y + 5) * k,
            },
          ]}
        >
          <View
            style={[
              s.side,
              { backgroundColor: ink, width: 22 * k, height: 22 * k, borderRadius: 11 * k },
            ]}
          >
            <Text style={[typography.overline, { color: paper }]}>{t.player.sideA}</Text>
          </View>
          <Text style={[typography.label, s.flex, { color: ink }]} numberOfLines={1}>
            {title}
          </Text>
          {code ? <Text style={[typography.numeric, { color: ink }]}>{code}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function rect(r: { x: number; y: number; w: number; h: number }) {
  return { x: r.x, y: r.y, width: r.w, height: r.h };
}

const s = StyleSheet.create({
  shell: { flex: 1, borderWidth: stroke.selected, overflow: 'hidden' },
  reel: { position: 'absolute' },
  labelRow: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: space.sm },
  side: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
});
