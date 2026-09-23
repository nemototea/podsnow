import Svg, { Path, Rect } from 'react-native-svg';

import { useT } from '@/i18n';

import { wordmark } from './brand/wordmark';
import { useAppTheme } from './ThemeContext';

export function Wordmark({ width }: { width: number }) {
  const c = useAppTheme();
  const t = useT();
  const { dot } = wordmark;
  return (
    <Svg
      width={width}
      height={(width * wordmark.height) / wordmark.width}
      viewBox={`0 0 ${wordmark.width} ${wordmark.height}`}
      accessible
      accessibilityRole="image"
      accessibilityLabel={t.app.name}
    >
      <Path d={wordmark.d} fill={c.textPrimary} />
      <Rect x={dot.x} y={dot.y} width={dot.size} height={dot.size} rx={dot.r} fill={c.accentText} />
    </Svg>
  );
}
