import Svg, { Path } from 'react-native-svg';

import { useT } from '@/i18n';

import { wordmark } from './brand/wordmark';
import { useAppTheme } from './ThemeContext';

/**
 * ロゴ `PodsNow.`（DESIGN_SYSTEM.md §3、Issue #235 案 A）。白の字に、点だけアクセントの色。
 * `size` は見本 `.wm` の字の大きさ。箱の高さは字の大きさと同じ（line-height 1）。
 */
export function Wordmark({ size }: { size: number }) {
  const c = useAppTheme();
  const t = useT();
  const scale = size / wordmark.height;
  return (
    <Svg
      width={wordmark.width * scale}
      height={size}
      viewBox={`0 0 ${wordmark.width} ${wordmark.height}`}
      accessible
      accessibilityRole="image"
      accessibilityLabel={t.app.name}
    >
      <Path d={wordmark.ink} fill={c.textPrimary} />
      <Path d={wordmark.dot} fill={c.accentSolid} />
    </Svg>
  );
}
