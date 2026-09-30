import { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';

import { halftone } from '../tokens';

/** 面の飾りの網点（DESIGN_SYSTEM.md §2.5）。親いっぱいに敷く。文字の下には置かない。 */
export function Halftone({ color }: { color: string }) {
  const id = `halftone-${useId().replace(/:/g, '')}`;
  const p = halftone.pitch;
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <Pattern id={id} width={p} height={p} patternUnits="userSpaceOnUse">
          <Circle cx={p / 2} cy={p / 2} r={halftone.dot} fill={color} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}
