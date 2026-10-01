import Svg, { G, Path, Rect } from 'react-native-svg';

import { useT } from '@/i18n';

import { wordmark } from './brand/wordmark';
import { useAppTheme } from './ThemeContext';

/**
 * ロゴ `PodsNow.`（DESIGN_SYSTEM.md §3、#190）。版ズレ → 字 → 点の順に重ねる。
 * ライトの黄の点は紙の上で 3:1 を持てないので、墨の輪郭と組にする（§3.2）。
 */
export function Wordmark({ width }: { width: number }) {
  const c = useAppTheme();
  const t = useT();
  const { dot, misreg } = wordmark;
  const inset = c.isDark ? 0 : dot.edge;
  return (
    <Svg
      width={width}
      height={(width * wordmark.height) / wordmark.width}
      viewBox={`0 0 ${wordmark.width} ${wordmark.height}`}
      accessible
      accessibilityRole="image"
      accessibilityLabel={t.app.name}
    >
      <G transform={`translate(${misreg.dx} ${misreg.dy})`}>
        <Path d={wordmark.d} fill={c.brandShadow} />
      </G>
      <Path d={wordmark.d} fill={c.brandInk} />
      {c.isDark ? null : (
        <Rect
          x={dot.x}
          y={dot.y}
          width={dot.size}
          height={dot.size}
          rx={dot.r}
          fill={c.controlBorder}
        />
      )}
      <Rect
        x={dot.x + inset}
        y={dot.y + inset}
        width={dot.size - inset * 2}
        height={dot.size - inset * 2}
        rx={Math.max(0, dot.r - inset / 2)}
        fill={c.brandAccent}
      />
    </Svg>
  );
}
