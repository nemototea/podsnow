import { memo } from 'react';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

import { icon as iconSize } from './tokens';

type Shape =
  | { k: 'path'; d: string; fill?: boolean; w?: number }
  | { k: 'rect'; x: number; y: number; w: number; h: number; r: number; fill?: boolean }
  | { k: 'circle'; cx: number; cy: number; r: number; fill?: boolean; dash?: string }
  | { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number };

const p = (d: string, fill = false, w?: number): Shape =>
  w === undefined ? { k: 'path', d, fill } : { k: 'path', d, fill, w };

/**
 * 名前は形ではなく意味で付け、1 つの意味に 1 つの形を当てる。対応表は DESIGN_SYSTEM.md §6.4。
 * 見本 docs/design-refresh/ds4/mock.html にある形（`P`）は、その SVG をそのまま写す（Issue #235）。
 * どの OS でもこの SVG を描く。SF Symbols（symbols.ts）は iOS のネイティブのメニューの項目だけに使う。
 */
const SHAPES = {
  // 下部タブ（見本 `.tabs`）。ホームは塗り
  home: [p('M12 3 3 10.5V21h6.5v-6h5v6H21V10.5Z', true)],
  search: [{ k: 'circle', cx: 11, cy: 11, r: 6.5 }, p('m16 16 4.5 4.5')],
  library: [p('M5 4v16M10 4v16M15 4.5l4.5 15.5')],
  plus: [p('M12 4v16M4 12h16')],
  minus: [p('M5 12h14')],
  arrow: [p('m9 5 7 7-7 7')],
  back: [p('M15 5 8 12l7 7', false, 2.2)],
  chevron: [p('m5 9 7 7 7-7', false, 2.2)],
  chevronUp: [p('m7 14 5-5 5 5')],
  grip: [p('M5 8h14M5 12h14M5 16h14')],
  play: [p('M8 5v14l11-7Z', true)],
  // 秒数入りの戻る・進む（プレーヤー）。画面移動の山形（back / arrow）と形を分ける。
  // 数字は線幅 1.5 で描く（2 では 7 の高さに収まらない）。
  skipBack15: [
    p('M12 3.5a9 9 0 1 1-9 9'),
    p('M14.5 1 12 3.5 14.5 6'),
    p('M8.3 10.6 9.8 9.5v7', false, 1.5),
    p('M15.6 9.5h-3l-.3 3.1c.5-.4 1.1-.6 1.7-.6a2 2 0 0 1 0 4.5c-.8 0-1.5-.3-1.9-.8', false, 1.5),
  ],
  skipForward30: [
    p('M12 3.5a9 9 0 1 0 9 9'),
    p('M9.5 1 12 3.5 9.5 6'),
    p(
      'M7.4 10.2c.4-.5 1-.8 1.7-.8a1.7 1.7 0 0 1 0 3.4h-.7.7a1.8 1.8 0 0 1 0 3.7c-.8 0-1.5-.3-1.9-.9',
      false,
      1.5,
    ),
    p(
      'M14.3 9.5a1.7 1.7 0 0 1 1.7 1.7v3.6a1.7 1.7 0 0 1-3.4 0v-3.6a1.7 1.7 0 0 1 1.7-1.7Z',
      false,
      1.5,
    ),
  ],
  pause: [
    { k: 'rect', x: 6, y: 5, w: 4, h: 14, r: 1, fill: true },
    { k: 'rect', x: 14, y: 5, w: 4, h: 14, r: 1, fill: true },
  ],
  // 先頭へ戻る（縦棒と左向きの三角）
  toStart: [{ k: 'rect', x: 5, y: 5, w: 3, h: 14, r: 1, fill: true }, p('M19 5v14L9 12Z', true)],
  stop: [{ k: 'rect', x: 6, y: 6, w: 12, h: 12, r: 2, fill: true }],
  record: [{ k: 'circle', cx: 12, cy: 12, r: 7, fill: true }],
  flag: [p('M6 21V4M6 4h11l-2 4 2 4H6')],
  check: [p('m5 12 4.5 4.5L19 7', false, 3)],
  copy: [{ k: 'rect', x: 8, y: 8, w: 12, h: 13, r: 2 }, p('M15 8V3H3v12h5')],
  // 線はつまみの手前で切る。背景色で塗りつぶして隠すと、押下面など bg 以外の上で丸が浮く。
  settings: [
    p('M4 7h2M12 7h8M4 17h8M18 17h2'),
    { k: 'circle', cx: 9, cy: 7, r: 3 },
    { k: 'circle', cx: 15, cy: 17, r: 3 },
  ],
  more: [
    { k: 'circle', cx: 5, cy: 12, r: 1.8, fill: true },
    { k: 'circle', cx: 12, cy: 12, r: 1.8, fill: true },
    { k: 'circle', cx: 19, cy: 12, r: 1.8, fill: true },
  ],
  music: [
    p('M9 18V6l10-2v12'),
    { k: 'circle', cx: 7, cy: 18, r: 2.5, fill: true },
    { k: 'circle', cx: 17, cy: 16, r: 2.5, fill: true },
  ],
  headphones: [
    p('M4 14v-2a8 8 0 0 1 16 0v2'),
    { k: 'rect', x: 3, y: 12, w: 4, h: 8, r: 2 },
    { k: 'rect', x: 17, y: 12, w: 4, h: 8, r: 2 },
  ],
  mic: [
    { k: 'rect', x: 9, y: 3, w: 6, h: 11, r: 3, fill: true },
    p('M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21'),
  ],
  // 録音の入力の種類（Issue #179）。内蔵は `mic`、有線は `headphones`
  usb: [
    p('M9 9V4h6v5'),
    { k: 'rect', x: 7, y: 9, w: 10, h: 8, r: 2 },
    p('M12 17v4M11 6.5h.01M13 6.5h.01'),
  ],
  bluetooth: [p('m7 7 10 10-5 5V2l5 5L7 17')],
  undo: [p('M9 14 4 9l5-5'), p('M4 9h10a6 6 0 0 1 0 12h-3')],
  redo: [p('m15 14 5-5-5-5'), p('M20 9H10a6 6 0 0 0 0 12h3')],
  // 無音を詰める（左右から中央の線へ寄せる）
  trimSilence: [p('M12 4v16M3 12h6m0 0-3-3m3 3-3 3M21 12h-6m0 0 3-3m-3 3 3 3')],
  scissors: [
    { k: 'circle', cx: 6, cy: 6, r: 3 },
    { k: 'circle', cx: 6, cy: 18, r: 3 },
    p('m8.5 8 11.5 13M8.5 16 20 3'),
  ],
  share: [p('M12 3v12M7 8l5-5 5 5M5 14v6h14v-6')],
  // 音声ファイルを書き出す・書き出し済み。OS の共有（share）とは別の形
  export: [p('M14 3H6v18h12V7Zm0 0v4h4'), p('M12 10v7m0 0-3-3m3 3 3-3')],
  download: [p('M12 3v13m0 0-5-5m5 5 5-5M5 14v7h14v-7')],
  // 番組のアートワーク・その代わりの絵。押せそうに見える再生の形を使わない
  artwork: [
    { k: 'rect', x: 3, y: 5, w: 18, h: 14, r: 2 },
    { k: 'circle', cx: 9, cy: 10, r: 1.5 },
    p('m4 18 5-5 4 4 3-3 4 4'),
  ],
  close: [p('m6 6 12 12M18 6 6 18')],
  refresh: [p('M20 10a8 8 0 1 0 0 6M20 4v6h-6')],
  warning: [p('m12 3 10 18H2Z'), p('M12 9v5m0 3v1')],
  // 録音の入力が切り替わった印
  route: [p('M4 8h15m0 0-4-4m4 4-4 4M20 16H5m0 0 4-4m-4 4 4 4')],
  trash: [p('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13')],
  star: [p('m12 3 2.8 5.8 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.7l6.2-.9Z')],
  starFilled: [p('m12 3 2.8 5.8 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.7l6.2-.9Z', true)],
  // エピソードの状態（Home）。未録音 → 編集中 → 書き出し済み（export）→ 配信済み、と音声なし
  // 破線は円周（2π×8）を 8 等分する。丸い端の分だけ線を短くしている
  statusNew: [{ k: 'circle', cx: 12, cy: 12, r: 8, dash: '2.28 4' }],
  statusEditing: [{ k: 'circle', cx: 12, cy: 12, r: 8 }, p('M12 4a8 8 0 0 0 0 16Z', true)],
  published: [
    { k: 'circle', cx: 12, cy: 12, r: 1.5, fill: true },
    p(
      'M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9.2 9.2 0 0 0 0 13M18.5 5.5a9.2 9.2 0 0 1 0 13',
    ),
  ],
  noAudio: [p('M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4'), p('m3 3 18 18')],
  edit: [p('M4 20h4L19 9l-4-4L4 16Z')],
  info: [{ k: 'circle', cx: 12, cy: 12, r: 9 }, p('M12 11v6M12 7.5v.01')],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof SHAPES;

/** 線幅 2 の SVG アイコン。すべての OS で使う（見本の形をそのまま描くため）。 */
export const IconSvg = memo(function IconSvg({
  name,
  color,
  size = iconSize.md,
}: {
  name: IconName;
  color: string;
  size?: number;
}) {
  const shapes: readonly Shape[] = SHAPES[name];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {shapes.map((s, i) => {
        switch (s.k) {
          case 'path':
            return (
              <Path
                key={i}
                d={s.d}
                fill={s.fill ? color : 'none'}
                stroke={s.fill ? 'none' : color}
                {...(s.w ? { strokeWidth: s.w } : {})}
              />
            );
          case 'rect':
            return (
              <Rect
                key={i}
                x={s.x}
                y={s.y}
                width={s.w}
                height={s.h}
                rx={s.r}
                fill={s.fill ? color : 'none'}
                stroke={s.fill ? 'none' : color}
              />
            );
          case 'circle':
            return (
              <Circle
                key={i}
                cx={s.cx}
                cy={s.cy}
                r={s.r}
                fill={s.fill ? color : 'none'}
                stroke={s.fill ? 'none' : color}
                {...(s.dash ? { strokeDasharray: s.dash } : {})}
              />
            );
          case 'ellipse':
            return <Ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill="none" />;
        }
      })}
    </Svg>
  );
});
