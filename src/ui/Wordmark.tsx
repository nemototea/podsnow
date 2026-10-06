import Svg, { G, Path, Rect } from 'react-native-svg';

import { useT } from '@/i18n';

import { wordmark } from './brand/wordmark';
import { useAppTheme } from './ThemeContext';

/**
 * ロゴ `PodsNow.`（DESIGN_SYSTEM.md §3、#190）。版ズレ → 字 → 点の順に重ねる。
 */
export function Wordmark({ width }: { width: number }) {
  const c = useAppTheme();
  const t = useT();
  const { dot, misreg } = wordmark;
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
      <Rect
        x={dot.x}
        y={dot.y}
        width={dot.size}
        height={dot.size}
        rx={dot.r}
        fill={c.brandAccent}
      />
    </Svg>
  );
}
