import { memo } from 'react';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

import { useAppTheme } from './ThemeContext';
import { icon as iconSize } from './tokens';

type Shape =
  | { k: 'path'; d: string; fill?: boolean; w?: number }
  | { k: 'rect'; x: number; y: number; w: number; h: number; r: number; fill?: boolean }
  | { k: 'circle'; cx: number; cy: number; r: number; fill?: boolean; knock?: boolean }
  | { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number };

const p = (d: string, fill = false, w?: number): Shape =>
  w === undefined ? { k: 'path', d, fill } : { k: 'path', d, fill, w };

const SHAPES = {
  plus: [p('M12 5v14M5 12h14')],
  minus: [p('M5 12h14')],
  arrow: [p('m9 5 7 7-7 7')],
  back: [p('m15 5-7 7 7 7')],
  chevron: [p('m7 10 5 5 5-5')],
  chevronUp: [p('m7 14 5-5 5 5')],
  up: [p('M12 19V5m0 0-6 6m6-6 6 6')],
  down: [p('M12 5v14m0 0-6-6m6 6 6-6')],
  play: [p('m8 5 11 7-11 7Z', true)],
  pause: [p('M9 6v12M15 6v12', false, 3)],
  stop: [{ k: 'rect', x: 6, y: 6, w: 12, h: 12, r: 2, fill: true }],
  record: [{ k: 'circle', cx: 12, cy: 12, r: 7, fill: true }],
  flag: [p('M5 21V4m0 0h12l-3 4 3 4H5')],
  check: [p('m5 12 4 4L19 6')],
  copy: [{ k: 'rect', x: 8, y: 8, w: 12, h: 13, r: 2 }, p('M15 8V3H3v12h5')],
  settings: [
    p('M4 7h16M4 17h16'),
    { k: 'circle', cx: 9, cy: 7, r: 3, knock: true },
    { k: 'circle', cx: 15, cy: 17, r: 3, knock: true },
  ],
  more: [
    { k: 'circle', cx: 5, cy: 12, r: 1.4, fill: true },
    { k: 'circle', cx: 12, cy: 12, r: 1.4, fill: true },
    { k: 'circle', cx: 19, cy: 12, r: 1.4, fill: true },
  ],
  music: [
    p('M9 18V5l10-2v13M9 8l10-2'),
    { k: 'ellipse', cx: 6, cy: 18, rx: 3, ry: 2 },
    { k: 'ellipse', cx: 16, cy: 16, rx: 3, ry: 2 },
  ],
  headphones: [
    p('M4 14v-2a8 8 0 0 1 16 0v2'),
    { k: 'rect', x: 3, y: 12, w: 4, h: 8, r: 2 },
    { k: 'rect', x: 17, y: 12, w: 4, h: 8, r: 2 },
  ],
  mic: [{ k: 'rect', x: 9, y: 3, w: 6, h: 11, r: 3 }, p('M5 11a7 7 0 0 0 14 0M12 18v3')],
  undo: [p('M4 7h9a6 6 0 0 1 0 12H8M4 7l5-5M4 7l5 5')],
  redo: [p('M20 7h-9a6 6 0 0 0 0 12h5M20 7l-5-5M20 7l-5 5')],
  retake: [p('M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5')],
  scissors: [
    { k: 'circle', cx: 6, cy: 6, r: 3 },
    { k: 'circle', cx: 6, cy: 18, r: 3 },
    p('m8.5 8 11.5 13M8.5 16 20 3'),
  ],
  share: [p('M12 16V3m0 0L7 8m5-5 5 5M5 14v7h14v-7')],
  download: [p('M12 3v13m0 0-5-5m5 5 5-5M5 14v7h14v-7')],
  episodes: [{ k: 'rect', x: 5, y: 3, w: 15, h: 17, r: 2 }, p('M9 8h7M9 12h7M2 7v16h14')],
  show: [{ k: 'rect', x: 4, y: 4, w: 16, h: 16, r: 3 }, p('m10 8 6 4-6 4Z')],
  close: [p('m6 6 12 12M18 6 6 18')],
  volume: [p('M4 9v6h4l5 4V5L8 9Zm12 0a5 5 0 0 1 0 6')],
  refresh: [p('M20 10a8 8 0 1 0 0 6M20 4v6h-6')],
  warning: [p('m12 3 10 18H2Z'), p('M12 9v5m0 3v1')],
  trash: [p('M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6')],
  star: [p('m12 3 2.8 5.8 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.7l6.2-.9Z')],
  starFilled: [p('m12 3 2.8 5.8 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.7l6.2-.9Z', true)],
  archive: [{ k: 'rect', x: 3, y: 4, w: 18, h: 5, r: 1 }, p('M5 9v11h14V9M10 13h4')],
  edit: [p('M4 20h4L19 9l-4-4L4 16Z')],
  rewind: [p('M11 7 6 12l5 5M18 7l-5 5 5 5')],
  forward: [p('m13 7 5 5-5 5M6 7l5 5-5 5')],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof SHAPES;

export const Icon = memo(function Icon({
  name,
  color,
  size = iconSize.md,
}: {
  name: IconName;
  color: string;
  size?: number;
}) {
  const c = useAppTheme();
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
                fill={s.fill ? color : s.knock ? c.bg : 'none'}
                stroke={s.fill ? 'none' : color}
              />
            );
          case 'ellipse':
            return <Ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill="none" />;
        }
      })}
    </Svg>
  );
});
