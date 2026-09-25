// 編集タブの録音機の部品（PN-01、#115。DESIGN_SYSTEM.md §6.3）。
//
// 録音機の表現は編集タブだけで使う。ほかの画面は従来の部品（`components.tsx`）で作る。
// 質感は 2 つだけ: 黒いガラスの表示窓（Display）と、押し込めるキー（Key）。
// 飾りだけの部品（ビス・シボ・基板・紙）は作らない。どの部品も状態を示すか、操作を受ける。
//
// 光沢と反射は react-native-svg の線形グラデーションで描く（`Sheen`）。色は既存トークンに不透明度を
// 掛けるだけで、新しい色を作らない（透過のトークンを増やさない。DESIGN_SYSTEM.md §5.5）。
import { useId, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type BoxShadowValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Text } from './Text';
import { DarkInside, useAppTheme } from './ThemeContext';
import {
  type Colors,
  displayFrame,
  keyDepth,
  radius,
  space,
  stroke,
  tabularNums,
  typography,
} from './tokens';
import { useReducedMotion } from './useReducedMotion';

type Theme = Colors & { isDark: boolean };

/** Android 9 未満は boxShadow を描けない。形は輪郭 `keyEdge` が運ぶ（DESIGN_SYSTEM.md §6）。 */
export const canShadow = Platform.OS !== 'android' || Number(Platform.Version) >= 28;

export type KeyTone = 'neutral' | 'accent' | 'rec' | 'danger';

export interface KeyLook {
  face: string;
  side: string;
  ink: string;
  edge: string;
}

/** キーの天面・側面・記号の色。無効なキーは沈んだまま（側面なし）で、色だけで反応する。 */
export function keyLook(c: Theme, tone: KeyTone, off: boolean): KeyLook {
  if (off)
    return { face: c.surfaceRaised, side: c.surfaceRaised, ink: c.textDisabled, edge: c.border };
  switch (tone) {
    case 'accent':
      return { face: c.accentSolid, side: c.keySideAccent, ink: c.accentOnSolid, edge: c.keyEdge };
    case 'rec':
      return { face: c.recSolid, side: c.keySideRec, ink: c.recOnSolid, edge: c.keyEdge };
    case 'danger':
      return {
        face: c.dangerSolid,
        side: c.dangerSolidPressed,
        ink: c.dangerOnSolid,
        edge: c.keyEdge,
      };
    default:
      return { face: c.key, side: c.keySide, ink: c.textPrimary, edge: c.keyEdge };
  }
}

/** 天面の上辺の光、側面の厚み、下に落ちる柔らかい影。押すと側面と影が縮む。 */
export function keyShadow(c: Theme, look: KeyLook, pressed: boolean): BoxShadowValue[] {
  if (!canShadow) return [];
  return [
    { offsetX: 0, offsetY: 1, color: c.keyHi, inset: true },
    {
      offsetX: 0,
      offsetY: pressed ? keyDepth.pressedSide : keyDepth.side,
      blurRadius: 0,
      color: look.side,
    },
    {
      offsetX: 0,
      offsetY: pressed ? keyDepth.pressedShadowY : keyDepth.shadowY,
      blurRadius: pressed ? keyDepth.pressedShadowBlur : keyDepth.shadowBlur,
      spreadDistance: keyDepth.shadowSpread,
      color: c.keyShadow,
    },
  ];
}

/** 光沢の種類。天面の丸み（key）、ガラスの映り込み（glass）。 */
export type SheenKind = 'key' | 'glass';

const SHEEN: Record<SheenKind, { x2: string; y2: string; stops: [number, number][] }> = {
  // 上から 45% までが明るく、そこから天面の色に戻る
  key: {
    x2: '0',
    y2: '1',
    stops: [
      [0, 0.32],
      [0.45, 0.06],
      [1, 0],
    ],
  },
  // 左上から斜めに 1 枚の映り込みがあり、途中でくっきり切れる
  glass: {
    x2: '1',
    y2: '0.55',
    stops: [
      [0, 0.09],
      [0.38, 0.03],
      [0.382, 0],
      [1, 0],
    ],
  },
};

/** 光沢の重ね。親の角丸に合わせて切り抜かれる前提（親に overflow: 'hidden' か同じ角丸を置く）。 */
export function Sheen({ kind, rounded = 0 }: { kind: SheenKind; rounded?: number }) {
  const c = useAppTheme();
  const id = `sheen-${kind}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const g = SHEEN[kind];
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2={g.x2} y2={g.y2}>
            {g.stops.map(([offset, opacity]) => (
              <Stop key={offset} offset={offset} stopColor={c.dispInk} stopOpacity={opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          rx={rounded}
          ry={rounded}
          fill={`url(#${id})`}
        />
      </Svg>
    </View>
  );
}

/**
 * 押し込めるキー。記号（アイコン）をキーの上に、名前（`caption`）をキーの下の面に置く。
 * 名前を出さないキーも `label` を読み上げに使う。
 */
export function Key({
  label,
  caption,
  onPress,
  onLongPress,
  tone = 'neutral',
  disabled,
  busy,
  selected,
  style,
  children,
  led,
}: {
  label: string;
  caption?: string;
  onPress: () => void;
  onLongPress?: () => void;
  tone?: KeyTone;
  disabled?: boolean;
  busy?: boolean;
  /** 押し込まれたまま（選ばれている）キー。 */
  selected?: boolean;
  /** キーの大きさ（幅・高さ・角丸）。 */
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** キーの隅の LED。録音中など、キーが今動いている状態を示す。 */
  led?: boolean;
}) {
  const c = useAppTheme();
  const reduced = useReducedMotion();
  const off = !!(disabled || busy);
  const look = keyLook(c, tone, off);
  const rounded = StyleSheet.flatten(style)?.borderRadius;
  return (
    <View style={s.keyCell}>
      <Pressable
        onPress={onPress}
        {...(onLongPress ? { onLongPress } : {})}
        disabled={off}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: off, busy: !!busy, ...(selected ? { selected } : {}) }}
        style={({ pressed }) => {
          const down = (pressed || !!selected) && !off;
          return [
            s.key,
            {
              backgroundColor: look.face,
              borderColor: look.edge,
              boxShadow: off ? [] : keyShadow(c, look, down),
              transform: [{ translateY: down && !reduced ? keyDepth.travel : 0 }],
            },
            style,
          ];
        }}
      >
        {off ? null : (
          <Sheen kind="key" rounded={typeof rounded === 'number' ? rounded : radius.md} />
        )}
        {busy ? <ActivityIndicator color={look.ink} /> : children}
        {led && !off ? (
          <View style={s.ledCorner}>
            <Led color={tone === 'neutral' ? c.accentSolid : look.ink} />
          </View>
        ) : null}
      </Pressable>
      {caption ? (
        <Text
          style={[
            typography.caption,
            s.keyCaption,
            { color: off ? c.textDisabled : c.textPrimary },
          ]}
          numberOfLines={2}
          importantForAccessibility="no"
        >
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

/** キーの記号の色。Key の子に置くアイコンに渡す。 */
export function useKeyInk(tone: KeyTone = 'neutral', off = false): string {
  const c = useAppTheme();
  return keyLook(c, tone, off).ink;
}

/**
 * 表示窓。面に沈んだ縁（`well`）の中に、黒いガラス（`dispBg`）を置く。
 * 中はテーマに関係なくダークの色で描く（`DarkInside`）。映り込みは 1 枚だけ。
 */
export function Display({
  children,
  style,
  innerStyle,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  innerStyle?: StyleProp<ViewStyle>;
}) {
  const c = useAppTheme();
  return (
    <View
      style={[
        s.bezel,
        {
          backgroundColor: c.well,
          boxShadow: canShadow
            ? [
                { offsetX: 0, offsetY: 2, blurRadius: 3, color: c.keyShadow, inset: true },
                { offsetX: 0, offsetY: 1, color: c.seamLight },
              ]
            : [],
        },
        style,
      ]}
    >
      <View style={[s.glass, { backgroundColor: c.dispBg, borderColor: c.dispLine }, innerStyle]}>
        <DarkInside>{children}</DarkInside>
        <Sheen kind="glass" />
      </View>
    </View>
  );
}

/** 表示窓の下段。名前と値の組を区切り線で並べる（入力・形式・残り、など）。 */
export function DisplayCells({
  cells,
}: {
  cells: {
    label: string;
    value: string;
    onPress?: () => void;
    a11yHint?: string;
  }[];
}) {
  const c = useAppTheme();
  return (
    <View style={[s.cells, { borderTopColor: c.dispLine }]}>
      {cells.map((cell, i) => {
        const body = (
          <>
            <Text style={[typography.overline, { color: c.dispDim }]} numberOfLines={1}>
              {cell.label}
            </Text>
            <Text style={[typography.label, s.tabular, { color: c.dispInk }]} numberOfLines={2}>
              {cell.value}
            </Text>
          </>
        );
        const divider =
          i > 0 ? { borderLeftColor: c.dispLine, borderLeftWidth: stroke.hairline } : null;
        return cell.onPress ? (
          <Pressable
            key={cell.label}
            onPress={cell.onPress}
            accessibilityRole="button"
            accessibilityLabel={`${cell.label} ${cell.value}`}
            {...(cell.a11yHint ? { accessibilityHint: cell.a11yHint } : {})}
            style={({ pressed }) => [
              s.cell,
              divider,
              pressed ? { backgroundColor: c.dispLine } : null,
            ]}
          >
            {body}
          </Pressable>
        ) : (
          <View
            key={cell.label}
            style={[s.cell, divider]}
            accessible
            accessibilityLabel={`${cell.label} ${cell.value}`}
          >
            {body}
          </View>
        );
      })}
    </View>
  );
}

/** 状態を示す小さな灯り。点いているときだけ周りに光がにじむ。 */
export function Led({ color, on = true }: { color: string; on?: boolean }) {
  const c = useAppTheme();
  return (
    <View
      style={[
        s.led,
        {
          backgroundColor: on ? color : c.dispLine,
          boxShadow: on && canShadow ? [{ offsetX: 0, offsetY: 0, blurRadius: 6, color }] : [],
        },
      ]}
    />
  );
}

const s = StyleSheet.create({
  keyCell: { alignItems: 'center', gap: space.sm },
  key: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: stroke.hairline,
    overflow: 'visible',
  },
  keyCaption: { textAlign: 'center' },
  bezel: { borderRadius: displayFrame.radius, padding: displayFrame.bezel },
  glass: {
    borderRadius: displayFrame.radius - displayFrame.bezel,
    borderWidth: stroke.hairline,
    overflow: 'hidden',
  },
  cells: { flexDirection: 'row', borderTopWidth: stroke.hairline },
  cell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  tabular: tabularNums,
  ledCorner: { position: 'absolute', top: space.sm, right: space.sm },
  led: {
    width: space.sm - stroke.hairline,
    height: space.sm - stroke.hairline,
    borderRadius: radius.pill,
  },
});
