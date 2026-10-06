import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../ThemeContext';
import { radius, space, spin, stroke } from '../tokens';
import { SpinView, useSpin } from './useSpin';

/** ミニプレーヤー用の小さいカセット（DESIGN_SYSTEM.md §2.6）。読み上げは親が持つ。 */
export function MiniCassette({ size, playing }: { size: number; playing: boolean }) {
  const c = useAppTheme();
  const spinStyle = useSpin(playing, spin.reel);
  const reel = Math.round(size * 0.22);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        s.shell,
        {
          width: size * 1.4,
          height: size,
          borderColor: c.controlBorder,
          backgroundColor: c.surfaceHover,
        },
      ]}
    >
      <View
        style={[
          s.window,
          {
            height: reel + space.sm,
            backgroundColor: c.sketchPaper,
            borderColor: c.sketchInk,
          },
        ]}
      >
        {[0, 1].map((i) => (
          <SpinView
            key={i}
            style={[s.reel, { width: reel, height: reel, borderColor: c.sketchInk }, spinStyle]}
          >
            <View style={[s.tooth, { backgroundColor: c.sketchInk }]} />
          </SpinView>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  shell: {
    borderWidth: stroke.selected,
    borderRadius: radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  window: {
    width: '78%',
    borderWidth: stroke.hairline,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xs,
  },
  reel: {
    borderWidth: stroke.selected,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  tooth: { width: stroke.selected, height: '45%' },
});
