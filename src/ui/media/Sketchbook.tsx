import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '../Text';
import { useAppTheme } from '../ThemeContext';
import { buttonDepth, radius, space, stickerTilt, stroke, typography } from '../tokens';
import { useReducedMotion } from '../useReducedMotion';
import { Sticker } from './Sticker';

/** 今の話題のページ。 */
export interface SketchPage {
  /** めくりの判定に使う（話題の id）。 */
  key: string;
  no: string;
  progress: string;
  heading: string;
  /** 台本。空なら `placeholder` を薄く出す。 */
  body: string;
  placeholder: string;
  cue: string | null;
  next: string | null;
  a11y: string;
}

/** 話し始める前の表紙。 */
export interface SketchCover {
  title: string;
  count: string;
  a11y: string;
}

type Face = { kind: 'page'; page: SketchPage } | { kind: 'cover'; cover: SketchCover };

const RING_PITCH = 22;
const RING_H = 26;
const PAGE_MIN_H = 280;
const FLIP_MS = 380;
const FLIP_DEG = 95;
/** 下に重なって見えるページの数の上限と、1 枚ごとのずれ。 */
const STACK_MAX = 3;
const STACK_STEP = 5;
const BAND_SHARE = 0.3;
const MOTIF = [0, 1, 2, 3, 4];

/**
 * トークテーマのカンペ（DESIGN_SYSTEM.md §2.7、#190）。上にリングの付いたスケッチブックで、
 * 話し始める前は表紙、話し始めたら今の話題を 1 ページで大きく見せる。「次へ」で前のページが
 * リングを軸にめくれ上がる。「動きを減らす」ではめくらずに切り替える。
 */
export function Sketchbook({
  page,
  cover,
  remaining,
  onPressPage,
}: {
  page: SketchPage | null;
  cover: SketchCover;
  /** このページより後ろに残っているページ数（重なりの見た目だけに使う）。 */
  remaining: number;
  onPressPage?: () => void;
}) {
  const c = useAppTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const face: Face = page ? { kind: 'page', page } : { kind: 'cover', cover };
  const faceKey = page ? page.key : 'cover';
  // 直前の描画の面。めくりのとき、これを上に重ねてリングを軸に回す。
  const prevFace = useRef<Face | null>(null);
  const prevKey = useRef(faceKey);
  const [leaving, setLeaving] = useState<Face | null>(null);
  const flip = useSharedValue(0);

  useEffect(() => {
    if (prevKey.current === faceKey) return;
    prevKey.current = faceKey;
    const before = prevFace.current;
    if (!before || reduced) return;
    setLeaving(before);
    flip.set(0);
    flip.set(
      withTiming(1, { duration: FLIP_MS }, (finished) => {
        if (finished) runOnJS(setLeaving)(null);
      }),
    );
  }, [faceKey, reduced, flip]);

  // 上の effect のあとに走り、次の描画のために今の面を覚える（台本の書き換えも反映する）
  useEffect(() => {
    prevFace.current = face;
  });

  const leavingStyle = useAnimatedStyle(() => ({
    opacity: 1 - flip.get() * 0.4,
    transform: [{ perspective: 1200 }, { rotateX: `${-FLIP_DEG * flip.get()}deg` }],
  }));

  const rings = Math.max(0, Math.floor((width - space.xl) / RING_PITCH));
  const stack = Math.min(STACK_MAX, Math.max(0, remaining));

  const renderFace = (f: Face) =>
    f.kind === 'cover' ? (
      <View
        style={[s.sheet, s.cover, { backgroundColor: c.sketchCover, borderColor: c.sketchInk }]}
        accessible
        accessibilityLabel={f.cover.a11y}
      >
        <View style={[s.label, { backgroundColor: c.sketchPaper, borderColor: c.sketchInk }]}>
          <Text style={[typography.sign, { color: c.sketchInk }]}>{f.cover.title}</Text>
          <Text style={[typography.numeric, { color: c.sketchInkSoft }]}>{f.cover.count}</Text>
        </View>
        <View
          style={[
            s.band,
            {
              backgroundColor: c.sketchBand,
              borderTopColor: c.sketchInk,
              height: `${BAND_SHARE * 100}%`,
            },
          ]}
        >
          {MOTIF.map((i) => (
            <View key={i} style={[s.motif, { borderColor: c.sketchCover }]} />
          ))}
        </View>
      </View>
    ) : (
      <View style={[s.sheet, s.page, { backgroundColor: c.sketchPaper, borderColor: c.sketchInk }]}>
        <View style={s.pageTop}>
          <Text style={[typography.numeric, { color: c.sketchInkSoft }]}>{f.page.no}</Text>
          {f.page.cue ? (
            <Sticker
              label={f.page.cue}
              fill={c.brandAccent}
              ink={c.sketchInk}
              tilt={stickerTilt(1)}
              numeric
            />
          ) : null}
        </View>
        <View style={s.pageMiddle}>
          <View>
            <View style={[s.highlight, { backgroundColor: c.brandShadow }]} />
            <Text style={[typography.display, s.center, { color: c.sketchInk }]}>
              {f.page.heading}
            </Text>
          </View>
          <Text style={[typography.body, s.center, { color: c.sketchInkSoft }]}>
            {f.page.body.trim() ? f.page.body : f.page.placeholder}
          </Text>
        </View>
        <View style={s.pageBottom}>
          <Text style={[typography.caption, s.flex, { color: c.sketchInkSoft }]} numberOfLines={1}>
            {f.page.next ?? ''}
          </Text>
          <Text style={[typography.numeric, { color: c.sketchInkSoft }]}>{f.page.progress}</Text>
        </View>
      </View>
    );

  return (
    <View style={s.root} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={s.book}>
        <View
          style={[
            s.layer,
            {
              left: space.md,
              right: space.md,
              top: 0,
              bottom: -(stack + 2) * STACK_STEP,
              backgroundColor: c.sketchBoard,
              borderColor: c.sketchInk,
            },
          ]}
        />
        {Array.from({ length: stack }, (_, i) => stack - i).map((n) => (
          <View
            key={n}
            style={[
              s.layer,
              {
                left: n * stroke.selected,
                right: n * stroke.selected,
                top: 0,
                bottom: -n * STACK_STEP,
                backgroundColor: c.sketchPaper,
                borderColor: c.sketchInk,
              },
            ]}
          />
        ))}
        <View
          style={{
            borderRadius: radius.sm,
            boxShadow: [
              {
                offsetX: buttonDepth.offsetLarge,
                offsetY: buttonDepth.offsetLarge,
                blurRadius: 0,
                color: c.controlShadow,
              },
            ],
          }}
        >
          {page && onPressPage ? (
            <Pressable
              onPress={onPressPage}
              accessibilityRole="button"
              accessibilityLabel={page.a11y}
            >
              {renderFace(face)}
            </Pressable>
          ) : page ? (
            <View accessible accessibilityLabel={page.a11y}>
              {renderFace(face)}
            </View>
          ) : (
            renderFace(face)
          )}
        </View>
        {leaving ? (
          <Reanimated.View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[s.leaving, leavingStyle]}
          >
            {renderFace(leaving)}
          </Reanimated.View>
        ) : null}
      </View>
      <View
        style={s.rings}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {Array.from({ length: rings }, (_, i) => (
          <View key={i} style={s.ringSlot}>
            <View style={[s.hole, { backgroundColor: c.bg, borderColor: c.sketchInk }]} />
            <View style={[s.ring, { borderColor: c.textSecondary }]} />
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { paddingTop: RING_H / 2, marginBottom: space.xl },
  book: { position: 'relative' },
  layer: {
    position: 'absolute',
    borderWidth: stroke.selected,
    borderRadius: radius.sm,
  },
  sheet: {
    minHeight: PAGE_MIN_H,
    borderWidth: stroke.selected,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  page: {
    paddingTop: space.xl,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    gap: space.md,
  },
  pageTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pageMiddle: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.md },
  pageBottom: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  highlight: {
    position: 'absolute',
    left: -space.xs,
    right: -space.xs,
    bottom: space.xs,
    height: space.md,
    borderRadius: radius.xs,
    opacity: 0.5,
  },
  center: { textAlign: 'center' },
  flex: { flex: 1 },
  cover: { justifyContent: 'center', alignItems: 'center' },
  label: {
    borderWidth: stroke.selected,
    borderRadius: radius.xs,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    alignItems: 'center',
    gap: space.xs,
    marginBottom: space.xxl,
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: stroke.selected,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  motif: {
    width: space.lg,
    height: space.lg,
    borderRadius: radius.pill,
    borderWidth: stroke.focus,
  },
  leaving: { position: 'absolute', left: 0, right: 0, top: 0, transformOrigin: 'top' },
  rings: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    top: 0,
    height: RING_H,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  ringSlot: { width: space.sm, height: RING_H },
  hole: {
    position: 'absolute',
    left: 0,
    top: RING_H - space.sm - space.hair,
    width: space.sm,
    height: space.sm,
    borderRadius: radius.pill,
    borderWidth: stroke.hairline,
  },
  ring: {
    position: 'absolute',
    left: space.hair / 2,
    top: 0,
    width: space.sm - space.hair,
    height: RING_H - space.xs,
    borderWidth: stroke.selected,
    borderBottomWidth: 0,
    borderTopLeftRadius: radius.sm,
    borderTopRightRadius: radius.sm,
  },
});
