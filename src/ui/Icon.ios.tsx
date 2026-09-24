import { SymbolView } from 'expo-symbols';
import { memo } from 'react';

import { IconSvg, type IconName } from './IconSvg';
import { SYMBOLS } from './symbols';
import { icon as iconSize } from './tokens';

export type { IconName };

export const Icon = memo(function Icon({
  name,
  color,
  size = iconSize.md,
}: {
  name: IconName;
  color: string;
  size?: number;
}) {
  return (
    <SymbolView
      name={SYMBOLS[name]}
      tintColor={color}
      size={size}
      weight="medium"
      resizeMode="scaleAspectFit"
      style={{ width: size, height: size }}
      fallback={<IconSvg name={name} color={color} size={size} />}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
});
