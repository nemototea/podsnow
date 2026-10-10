import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Polygon } from 'react-native-svg';

import { Text } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { hit, radius, space, stroke, timeline, typography } from '@/ui/tokens';

import { snapPx } from './overlayDrag';

/** 引き終えてから、押したことにしない時間。 */
const DRAG_TAP_GUARD_MS = 400;
/** 帯の短さの下限（px）。BGM の端を引いても、これより短くしない。 */
const MIN_W = space.xl;
/** つまみの見た目（直径）。触れる面は `hit.min`。 */
const KNOB = space.md + space.hair;

export interface OverlayBarProps {
  id: string;
  /** 帯の左端と幅（波形の中身の座標、px）。 */
  left: number;
  width: number;
  /** 素材のレーンの中の上端。 */
  top: number;
  height: number;
  label: string;
  accessibilityLabel: string;
  fill: string;
  /** 帯の外（タイムラインの地）の色。フェードの斜めを地の色で切り欠いて見せる。 */
  ground: string;
  selected: boolean;
  /** 端を引いて長さを変えられるか（BGM）。 */
  resizable: boolean;
  fadeInPx: number;
  fadeOutPx: number;
  /** 吸い付く位置（px）。本編の始まり・終わり、ほかの帯の端。 */
  snaps: readonly number[];
  onPress: (id: string) => void;
  onMove: (id: string, deltaPx: number) => void;
  onResize: (id: string, edge: 'start' | 'end', deltaPx: number) => void;
  onFade: (id: string, fadeInPx: number, fadeOutPx: number) => void;
}

/**
 * 波形の素材の帯（Issue #254）。DAW のように、選んだ帯を指で動かす。
 * - 押すと選ぶ（選んでいない帯は横スクロールの邪魔をしないよう、引いても動かない）
 * - 選んだ帯を引くと動く。本編の始まり・終わりやほかの帯の端に吸い付く
 * - 上の 2 つの丸を引くとフェードイン / フェードアウトの長さ。帯の端の斜めで長さを見せる
 * - BGM は両端の棒を引いて長さを変える
 * 動かしている間は UI スレッドで帯を動かし、離したときだけ JS へ返す（選択のハンドルと同じ）。
 */
export const OverlayBar = memo(function OverlayBar(p: OverlayBarProps) {
  const c = useAppTheme();
  const mark = c.accentSolid;
  const dx = useSharedValue(0);
  const dl = useSharedValue(0);
  const dr = useSharedValue(0);
  const fin = useSharedValue(p.fadeInPx);
  const fout = useSharedValue(p.fadeOutPx);
  const base = useSharedValue(0);
  // 確定した値が戻ってきたら、動かしていた分を 0 に戻す
  useEffect(() => {
    dx.value = 0;
    dl.value = 0;
    dr.value = 0;
    fin.value = p.fadeInPx;
    fout.value = p.fadeOutPx;
  }, [p.left, p.width, p.fadeInPx, p.fadeOutPx, dx, dl, dr, fin, fout]);

  // 引いて離したときに、帯を押したことにもならないようにする（Web などで押下が続けて届く）
  const draggedAt = useRef(0);
  const markDragged = useCallback(() => {
    draggedAt.current = Date.now();
  }, []);
  const { id, left, width, snaps, onMove, onResize, onFade } = p;
  const move = useCallback((d: number) => onMove(id, d), [id, onMove]);
  const resize = useCallback(
    (edge: 'start' | 'end', d: number) => onResize(id, edge, d),
    [id, onResize],
  );
  const fade = useCallback((a: number, b: number) => onFade(id, a, b), [id, onFade]);

  const movePan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-6, 6])
        .onStart(() => {
          runOnJS(markDragged)();
        })
        .onUpdate((e) => {
          // 始まりか終わりのどちらかが吸い付けば、そこに合わせる
          const start = left + e.translationX;
          const s1 = snapPx(start, snaps);
          if (s1 !== start) {
            dx.value = s1 - left;
            return;
          }
          const s2 = snapPx(start + width, snaps);
          dx.value = s2 - width - left;
        })
        .onEnd(() => {
          if (dx.value !== 0) runOnJS(move)(dx.value);
        }),
    [dx, left, markDragged, move, snaps, width],
  );
  const startPan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-4, 4])
        .onStart(() => {
          runOnJS(markDragged)();
        })
        .onUpdate((e) => {
          const x = snapPx(left + e.translationX, snaps);
          dl.value = Math.min(width - MIN_W, x - left);
        })
        .onEnd(() => {
          if (dl.value !== 0) runOnJS(resize)('start', dl.value);
        }),
    [dl, left, markDragged, resize, snaps, width],
  );
  const endPan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-4, 4])
        .onStart(() => {
          runOnJS(markDragged)();
        })
        .onUpdate((e) => {
          const x = snapPx(left + width + e.translationX, snaps);
          dr.value = Math.max(MIN_W - width, x - left - width);
        })
        .onEnd(() => {
          if (dr.value !== 0) runOnJS(resize)('end', dr.value);
        }),
    [dr, left, markDragged, resize, snaps, width],
  );
  const finPan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-4, 4])
        .onBegin(() => {
          base.value = fin.value;
        })
        .onStart(() => {
          runOnJS(markDragged)();
        })
        .onUpdate((e) => {
          fin.value = Math.max(0, Math.min(width - fout.value, base.value + e.translationX));
        })
        .onEnd(() => {
          runOnJS(fade)(fin.value, fout.value);
        }),
    [base, fade, fin, fout, markDragged, width],
  );
  const foutPan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-4, 4])
        .onBegin(() => {
          base.value = fout.value;
        })
        .onStart(() => {
          runOnJS(markDragged)();
        })
        .onUpdate((e) => {
          fout.value = Math.max(0, Math.min(width - fin.value, base.value - e.translationX));
        })
        .onEnd(() => {
          runOnJS(fade)(fin.value, fout.value);
        }),
    [base, fade, fin, fout, markDragged, width],
  );

  const boxStyle = useAnimatedStyle(() => ({
    left: left + dx.value + dl.value,
    width: Math.max(MIN_W, width - dl.value + dr.value),
  }));
  const rampIn = useAnimatedStyle(() => ({ width: fin.value }));
  const rampOut = useAnimatedStyle(() => ({ width: fout.value }));
  const knobIn = useAnimatedStyle(() => ({ left: fin.value - hit.min / 2 }));
  const knobOut = useAnimatedStyle(() => ({ right: fout.value - hit.min / 2 }));

  const body = (
    <Animated.View
      style={[
        st.box,
        { top: p.top, height: p.height, backgroundColor: p.fill },
        p.selected ? { borderColor: mark, borderWidth: stroke.selected } : null,
        boxStyle,
      ]}
    >
      <Pressable
        style={st.fill}
        onPress={() => {
          if (Date.now() - draggedAt.current < DRAG_TAP_GUARD_MS) return;
          p.onPress(p.id);
        }}
        accessibilityRole="button"
        accessibilityLabel={p.accessibilityLabel}
        accessibilityState={{ selected: p.selected }}
      >
        {/* フェードの斜め。帯の角をタイムラインの地の色で三角に切り欠く */}
        <Animated.View pointerEvents="none" style={[st.rampIn, rampIn]}>
          <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
            <Polygon points="0,0 100,0 0,100" fill={p.ground} />
          </Svg>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[st.rampOut, rampOut]}>
          <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
            <Polygon points="0,0 100,0 100,100" fill={p.ground} />
          </Svg>
        </Animated.View>
        <Text numberOfLines={1} style={[st.label, { color: c.textPrimary }]}>
          {p.label}
        </Text>
      </Pressable>
      {p.selected ? (
        <>
          <GestureDetector gesture={finPan}>
            <Animated.View style={[st.knob, knobIn]} accessibilityElementsHidden>
              <View style={[st.dot, { backgroundColor: mark, borderColor: p.ground }]} />
            </Animated.View>
          </GestureDetector>
          <GestureDetector gesture={foutPan}>
            <Animated.View style={[st.knob, knobOut]} accessibilityElementsHidden>
              <View style={[st.dot, { backgroundColor: mark, borderColor: p.ground }]} />
            </Animated.View>
          </GestureDetector>
          {p.resizable ? (
            <>
              <GestureDetector gesture={startPan}>
                <View style={[st.edge, st.edgeStart]} accessibilityElementsHidden>
                  <View style={[st.grip, { backgroundColor: mark }]} />
                </View>
              </GestureDetector>
              <GestureDetector gesture={endPan}>
                <View style={[st.edge, st.edgeEnd]} accessibilityElementsHidden>
                  <View style={[st.grip, { backgroundColor: mark }]} />
                </View>
              </GestureDetector>
            </>
          ) : null}
        </>
      ) : null}
    </Animated.View>
  );
  // 選んでいない帯は引いても動かさない（横スクロールを優先する）
  return p.selected ? <GestureDetector gesture={movePan}>{body}</GestureDetector> : body;
});

const st = StyleSheet.create({
  // 見本 `.layer`: 角丸 4、左右 8、白の 10.5 / 700。
  box: { position: 'absolute', borderRadius: radius.xs },
  fill: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderRadius: radius.xs,
    overflow: 'hidden',
  },
  label: typography.overline,
  rampIn: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  rampOut: { position: 'absolute', right: 0, top: 0, bottom: 0 },
  knob: {
    position: 'absolute',
    top: -hit.min / 2,
    width: hit.min,
    height: hit.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: KNOB, height: KNOB, borderRadius: radius.pill, borderWidth: stroke.focus },
  edge: {
    position: 'absolute',
    top: (timeline.layer - hit.min) / 2,
    width: hit.min,
    height: hit.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  edgeStart: { left: -hit.min / 2 },
  edgeEnd: { right: -hit.min / 2 },
  grip: { width: timeline.handleW, height: timeline.layer, borderRadius: radius.pill },
});
