import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { Icon } from './Icon';
import { useAppTheme } from './ThemeContext';
import { icon, radius, stroke } from './tokens';

/**
 * 番組・回のアートワーク（Issue #101）。正方形。
 * 画像が無い・読めないときは番組のアイコンを置いた面にする（レイアウトを崩さない）。
 */
export function Artwork({
  uri,
  size,
  label,
}: {
  /** `https://` または `file://` */
  uri: string | null;
  size: number;
  /** 読み上げ用。飾りなら省く */
  label?: string;
}) {
  const c = useAppTheme();
  const [failed, setFailed] = useState<string | null>(null);
  const corner = size >= 96 ? radius.lg : radius.sm;
  const box = [
    s.box,
    {
      width: size,
      height: size,
      borderRadius: corner,
      backgroundColor: c.surfaceRaised,
      borderColor: c.border,
    },
  ];
  const a11y = label
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label }
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };
  if (!uri || failed === uri) {
    return (
      <View style={[box, s.center]} {...a11y}>
        <Icon name="show" color={c.textTertiary} size={size >= 96 ? icon.lg : icon.sm} />
      </View>
    );
  }
  return (
    <View style={box} {...a11y}>
      <Image
        source={{ uri }}
        style={{ width: size, height: size }}
        resizeMode="cover"
        onError={() => setFailed(uri)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  box: { overflow: 'hidden', borderWidth: stroke.hairline },
  center: { alignItems: 'center', justifyContent: 'center' },
});
