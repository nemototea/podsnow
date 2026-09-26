import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useGutter } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { artwork, motion, space } from '@/ui/tokens';
import { useReducedMotion } from '@/ui/useReducedMotion';

/** 文字を置かず、番組アートワークを不透明な Home 背景へ溶かす。 */
export function HomeArtwork({ uri }: { uri: string }) {
  const c = useAppTheme();
  const reduced = useReducedMotion();
  const gutter = useGutter();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  if (failedUri === uri) return null;
  return (
    <View
      style={[s.frame, { marginHorizontal: -gutter }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Image
        source={uri}
        contentFit="cover"
        transition={reduced ? 0 : motion.quick}
        onError={() => setFailedUri(uri)}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['transparent', c.bg]}
        locations={[artwork.homeFadeStart, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </View>
  );
}

const s = StyleSheet.create({
  frame: {
    aspectRatio: artwork.homeAspectRatio,
    marginTop: space.sm,
    overflow: 'hidden',
  },
});
