import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { formatSmp, smp, type Smp } from '@/domain/time';
import type { PlacedOverlay } from '@/domain/timeline/overlays';
import type { Range, VoiceSegment } from '@/domain/timeline/types';
import { snapToBoundary } from '@/domain/timeline/blocks';
import { placeVoice } from '@/domain/timeline/voice';
import { useT } from '@/i18n';
import type { RecordingEvent } from '@/infra/db/repositories/recordingEventsRepo';
import { Icon, Text } from '@/ui/components';
import { hit, icon, radius, space, stroke, tabularNums, timeline, typography } from '@/ui/tokens';
import { useAppTheme } from '@/ui/ThemeContext';

import { sampleVoiceColumns, type TakePeaks } from './peaks';
import { follow, pinchPps, release, reveal, zoomScroll, type FollowState } from './waveScroll';

const SAMPLE_RATE = 48000;
/** 0.1 秒（ハンドルを動かしている間に時間を知らせる刻み）。 */
const TENTH = SAMPLE_RATE / 10;
const COL_W = 3;
/** 塊の間（見本 `.lane` の gap 3）。 */
const CHUNK_GAP = 3;

export interface WaveformProps {
  voice: readonly VoiceSegment[];
  peaksByTake: ReadonlyMap<string, TakePeaks>;
  overlays: readonly PlacedOverlay[];
  assetNames?: readonly { id: string; name: string }[];
  /** 割り込みなど、アプリが記録した位置（DATA_MODEL.md §4.10）。 */
  events: readonly { event: RecordingEvent; at: Smp }[];
  total: Smp;
  playhead: Smp;
  /**
   * シーク・カット・取り消し / やり直しのたびに変わる値。変わったとき、再生位置が画面外なら
   * 見える位置へスクロールする（Issue #176）。
   */
  revealSeq: number;
  /** `revealSeq` が変わったときに見せる位置。省略・null なら再生位置（Issue #178）。 */
  revealAt?: Smp | null;
  selection: Range | null;
  selectedOverlay: string | null;
  /** 1 秒あたりのピクセル。 */
  pps: number;
  /** ピンチで拡大率を変えたとき（新しい 1 秒あたりのピクセル）。 */
  onZoom?: (pps: number) => void;
  onSeek: (to: Smp) => void;
  onSelectOverlay: (id: string | null) => void;
  /** 無音で区切られた声の塊（FR-EDIT-2）。2 回目のタップか長押しで選び、ハンドルで広げる。 */
  blocks?: readonly Range[];
  /**
   * 波形を押したとき（Issue #177）。指定しなければ、押した位置へシークするだけ。
   * 選ぶかどうかは呼び出し側が決める（`tapBlock`）。
   */
  onTap?: (at: Smp, longPress: boolean) => void;
  /** ハンドルのドラッグを確定したとき。 */
  onSelectionChange?: (range: Range) => void;
  /** ハンドルを動かしている間の範囲（0.1 秒ごと）。離したら null（Issue #177）。 */
  onSelectionDrag?: (range: Range | null) => void;
}

/**
 * 選択ハンドルの的。幅は `hit.min`（48）で、境界から選択の内側へは `HANDLE_IN` だけ、残りは外側へ張り出す。
 * 左右のハンドルが向き合う側を短くしてあるので、選択が 24px 未満にならない限り的どうしが重ならない。
 */
const HANDLE_W = hit.min;
const HANDLE_IN = space.md;
const EMPTY_BLOCKS: readonly Range[] = [];
const HEIGHT = timeline.lane;
/** 中身の左右の余白（見本 `.ruler` / `.lane` / `.layers` の左右 12）。時刻 0 の位置。 */
const PAD = space.md;
/** 目盛りの行（見本 `.ruler` の文字 12 と下の 8）。 */
const RULER = timeline.ruler;
/** 素材のレーン（見本 `.layer` の高さ 24、間 6、上 10）。上が差し込み素材、下が BGM・オープニング・エンディング。 */
const LAYER_H = timeline.layer;
const LAYER_GAP = space.x6;
const LAYERS_TOP = space.x10;
const LAYERS_H = LAYER_H * 2 + LAYER_GAP;
/** 目盛りの刻み（秒）と、隣の目盛りとの最小の間（px）。 */
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800] as const;
const TICK_MIN_GAP = 72;

/**
 * 声トラック + 素材レイヤーの波形タイムライン（FR-EDIT-8）。編集画面だけで使う。
 * 録音中は `RecordingView` の小さな波形に切り替わるので、ここは録音中の表示を持たない。
 * 表示中の範囲だけ棒を描く（60 分でも全体を描画しない）。
 */
export const Waveform = memo(function Waveform(p: WaveformProps) {
  const c = useAppTheme();
  const t = useT();
  const mark = c.accentSolid;
  const height = HEIGHT;
  const layersTop = RULER + height + LAYERS_TOP;
  const laneTop = layersTop + LAYERS_H + space.x6;
  const [viewW, setViewW] = useState(0);
  const [scrollX, setScrollX] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const totalSec = p.total / SAMPLE_RATE;
  const contentW = Math.max(viewW, totalSec * p.pps + viewW);
  const onLayout = useCallback((e: LayoutChangeEvent) => setViewW(e.nativeEvent.layout.width), []);

  // ---- 再生位置を追う（Issue #176） ----
  // スクロール位置と指の状態は描画に使わないので ref で持つ（描き直しを増やさない）
  const scrollXRef = useRef(0);
  const followRef = useRef<FollowState>({ dragging: false, armed: true });
  const headX = PAD + (p.playhead / SAMPLE_RATE) * p.pps;
  const viewport = useCallback(
    () => ({ scrollX: scrollXRef.current, viewW, contentW: contentW + PAD * 2 }),
    [contentW, viewW],
  );
  const scrollTo = useCallback((x: number) => {
    scrollXRef.current = x;
    scrollRef.current?.scrollTo({ x, animated: false });
  }, []);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollXRef.current = e.nativeEvent.contentOffset.x;
    setScrollX(e.nativeEvent.contentOffset.x);
  }, []);
  const onDragStart = useCallback(() => {
    followRef.current = { ...followRef.current, dragging: true };
  }, []);
  const onDragEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollXRef.current = e.nativeEvent.contentOffset.x;
      followRef.current = release(headX, viewport());
    },
    [headX, viewport],
  );

  // 拡大・縮小。再生位置を画面上の同じ位置に保つ。追う処理より先に動かす（先に追うと位置がずれる）
  const lastPps = useRef(p.pps);
  useEffect(() => {
    const oldPps = lastPps.current;
    lastPps.current = p.pps;
    if (viewW === 0 || oldPps === p.pps) return;
    scrollTo(
      zoomScroll({
        pad: PAD,
        headSec: p.playhead / SAMPLE_RATE,
        oldPps,
        newPps: p.pps,
        scrollX: scrollXRef.current,
        viewW,
        newContentW: contentW + PAD * 2,
      }),
    );
  }, [contentW, p.playhead, p.pps, scrollTo, viewW]);

  // 再生中など、再生位置が動いたとき。画面の外へ出たら追う
  useEffect(() => {
    if (viewW === 0) return;
    const r = follow(headX, viewport(), followRef.current);
    followRef.current = r.state;
    if (r.scrollTo !== null) scrollTo(r.scrollTo);
  }, [headX, scrollTo, viewW, viewport]);

  // シーク・カット・取り消し / やり直しの後。画面外なら見える位置へ移し、また追うようにする
  const lastReveal = useRef(p.revealSeq);
  useEffect(() => {
    if (viewW === 0 || lastReveal.current === p.revealSeq) return;
    lastReveal.current = p.revealSeq;
    const target = p.revealAt == null ? headX : PAD + (p.revealAt / SAMPLE_RATE) * p.pps;
    const to = reveal(target, viewport(), followRef.current);
    if (to !== null) scrollTo(to);
    if (!followRef.current.dragging) followRef.current = { dragging: false, armed: true };
  }, [headX, p.pps, p.revealAt, p.revealSeq, scrollTo, viewW, viewport]);

  // 可視範囲（前後 1 画面分の余裕）
  const from = Math.max(0, scrollX - viewW);
  const to = Math.min(contentW, scrollX + viewW * 2);
  const columns = useMemo(() => {
    // 削除の直後など、内容が縮んでスクロール位置が追いつく前は範囲が空になる。
    // 録音が無いときは棒を描かず、空の枠だけにする（Issue #179）
    if (viewW === 0 || to <= from || p.voice.length === 0) return null;
    const n = Math.ceil((to - from) / COL_W);
    const fromSmp = Math.floor((from / p.pps) * SAMPLE_RATE);
    const toSmp = Math.floor((to / p.pps) * SAMPLE_RATE);
    return { x: from, n, data: sampleVoiceColumns(p.voice, p.peaksByTake, fromSmp, toSmp, n) };
  }, [from, to, viewW, p.pps, p.voice, p.peaksByTake]);

  const xOf = (s: number) => (s / SAMPLE_RATE) * p.pps;
  // 目盛りの間隔。拡大率に合わせて、隣と重ならない最小の刻みを選ぶ（見本 `.ruler` は画面幅に 4 つ）
  const tickSec = TICK_STEPS.find((sec) => sec * p.pps >= TICK_MIN_GAP) ?? TICK_STEPS.at(-1)!;
  const selX = p.selection ? ([xOf(p.selection.start), xOf(p.selection.end)] as const) : null;
  const placed = useMemo(() => placeVoice(p.voice), [p.voice]);

  const tapAt = (x: number, longPress: boolean) => {
    if (!Number.isFinite(x)) return;
    const at = smp(Math.max(0, Math.min(p.total, (x / p.pps) * SAMPLE_RATE)));
    if (p.onTap) p.onTap(at, longPress);
    else p.onSeek(at);
  };

  // ---- 選択のハンドル ----
  // ドラッグ中は UI スレッドで矩形を動かし、離したときだけ React に返す。
  const selStart = useSharedValue(p.selection?.start ?? 0);
  const selEnd = useSharedValue(p.selection?.end ?? 0);
  const pps = p.pps;
  const blocks = p.blocks ?? EMPTY_BLOCKS;
  const total = p.total;
  useEffect(() => {
    selStart.value = p.selection?.start ?? 0;
    selEnd.value = p.selection?.end ?? 0;
  }, [p.selection, selStart, selEnd]);

  const { onSelectionChange, onSelectionDrag } = p;
  const commit = useCallback(
    (a: number, b: number) => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      // 隣の塊の切れ目に吸い付かせる（画面 12px 相当）
      const within = (12 / pps) * SAMPLE_RATE;
      onSelectionDrag?.(null);
      onSelectionChange?.({
        start: snapToBoundary(blocks, smp(lo), within),
        end: snapToBoundary(blocks, smp(hi), within),
      });
    },
    [blocks, onSelectionChange, onSelectionDrag, pps],
  );
  // 動かしている間の時間を JS へ渡す。0.1 秒が変わったときだけ（毎フレーム描き直さない）
  const dragging = useCallback(
    (a: number, b: number) => onSelectionDrag?.({ start: smp(a), end: smp(b) }),
    [onSelectionDrag],
  );
  const lastTenths = useSharedValue('');

  const startBase = useSharedValue(0);
  const endBase = useSharedValue(0);
  const startPan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-4, 4])
        .onBegin(() => {
          startBase.value = selStart.value;
        })
        .onUpdate((e) => {
          const delta = (e.translationX / pps) * SAMPLE_RATE;
          selStart.value = Math.max(0, Math.min(selEnd.value, startBase.value + delta));
          const key = `${Math.round(selStart.value / TENTH)}-${Math.round(selEnd.value / TENTH)}`;
          if (key !== lastTenths.value) {
            lastTenths.value = key;
            runOnJS(dragging)(selStart.value, selEnd.value);
          }
        })
        .onEnd(() => {
          lastTenths.value = '';
          runOnJS(commit)(selStart.value, selEnd.value);
        }),
    [commit, dragging, lastTenths, pps, selEnd, selStart, startBase],
  );
  const endPan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-4, 4])
        .onBegin(() => {
          endBase.value = selEnd.value;
        })
        .onUpdate((e) => {
          const delta = (e.translationX / pps) * SAMPLE_RATE;
          selEnd.value = Math.min(total, Math.max(selStart.value, endBase.value + delta));
          const key = `${Math.round(selStart.value / TENTH)}-${Math.round(selEnd.value / TENTH)}`;
          if (key !== lastTenths.value) {
            lastTenths.value = key;
            runOnJS(dragging)(selStart.value, selEnd.value);
          }
        })
        .onEnd(() => {
          lastTenths.value = '';
          runOnJS(commit)(selStart.value, selEnd.value);
        }),
    [commit, dragging, endBase, lastTenths, pps, selEnd, selStart, total],
  );

  // ---- ピンチで拡大・縮小 ----
  // 拡大率は shared value でも持ち、ピンチの途中で描き直されてもジェスチャーを作り直さない。
  // JS へは 4% 以上変わったときだけ返す（毎フレーム描き直さない）。位置は上の拡大・縮小の処理が保つ。
  const ppsNow = useSharedValue(pps);
  useEffect(() => {
    ppsNow.value = pps;
  }, [pps, ppsNow]);
  const pinchBase = useSharedValue(pps);
  const pinchSent = useSharedValue(pps);
  const { onZoom } = p;
  const zoomTo = useCallback((next: number) => onZoom?.(next), [onZoom]);
  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .enabled(!!onZoom)
        .onBegin(() => {
          pinchBase.value = ppsNow.value;
          pinchSent.value = ppsNow.value;
        })
        .onUpdate((e) => {
          const next = pinchPps(pinchBase.value, e.scale);
          if (Math.abs(next / pinchSent.value - 1) < 0.04) return;
          pinchSent.value = next;
          runOnJS(zoomTo)(next);
        })
        .onEnd((e) => {
          const next = pinchPps(pinchBase.value, e.scale);
          if (next !== pinchSent.value) runOnJS(zoomTo)(next);
        }),
    [onZoom, pinchBase, pinchSent, ppsNow, zoomTo],
  );

  const selectionStyle = useAnimatedStyle(() => ({
    left: (selStart.value / SAMPLE_RATE) * pps,
    width: Math.max(2, ((selEnd.value - selStart.value) / SAMPLE_RATE) * pps),
  }));
  const startStyle = useAnimatedStyle(() => ({
    left: (selStart.value / SAMPLE_RATE) * pps - (HANDLE_W - HANDLE_IN),
  }));
  const endStyle = useAnimatedStyle(() => ({
    left: (selEnd.value / SAMPLE_RATE) * pps - HANDLE_IN,
  }));

  return (
    <GestureDetector gesture={pinch}>
      <View onLayout={onLayout} style={styles.root}>
        <ScrollView
          ref={scrollRef}
          horizontal
          onScroll={onScroll}
          onScrollBeginDrag={onDragStart}
          onScrollEndDrag={onDragEnd}
          onMomentumScrollBegin={onDragStart}
          onMomentumScrollEnd={onDragEnd}
          scrollEventThrottle={32}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.content, { width: contentW }]}
        >
          <Pressable
            style={{ width: contentW, height: laneTop + space.xl }}
            onPress={(e) => tapAt(e.nativeEvent.locationX, false)}
            onLongPress={(e) => tapAt(e.nativeEvent.locationX, true)}
          >
            {/* 目盛り */}
            {Array.from({ length: Math.ceil(totalSec / tickSec) + 2 }).map((_, i) => (
              <Text
                key={i}
                style={[
                  styles.tick,
                  tabularNums,
                  { left: i * tickSec * p.pps, color: c.textTertiary },
                ]}
              >
                {formatSmp(smp(i * tickSec * SAMPLE_RATE))}
              </Text>
            ))}
            {/* 声 */}
            <View style={[styles.voiceTrack, { top: RULER, height }]}>
              {/* 塊（見本 `.chunk`）。無音で区切った塊ごとに角丸 4 の面を置き、間を 3 あける */}
              {(p.blocks?.length
                ? p.blocks
                : placed.map((x) => ({ start: x.start, end: x.end }))
              ).map((b) => {
                const left = xOf(b.start) + CHUNK_GAP / 2;
                const width = Math.max(2, xOf(b.end) - xOf(b.start) - CHUNK_GAP);
                const on =
                  !!p.selection && b.start >= p.selection.start && b.end <= p.selection.end;
                return (
                  <View
                    key={`${b.start}-${b.end}`}
                    pointerEvents="none"
                    style={[
                      styles.chunk,
                      { left, width, backgroundColor: on ? c.accentSubtle : c.voiceFill },
                    ]}
                  />
                );
              })}
              {columns
                ? Array.from({ length: columns.n }).map((_, i) => {
                    const lo = columns.data[i * 2]! / 127;
                    const hi = columns.data[i * 2 + 1]! / 127;
                    const h = Math.max(1, (hi - lo) * (height / 2));
                    const top = height / 2 - hi * (height / 2);
                    const x = columns.x + i * COL_W;
                    return (
                      <View
                        key={i}
                        style={{
                          position: 'absolute',
                          left: x,
                          top,
                          width: COL_W - 1,
                          height: h,
                          // 選択中の塊の棒はアクセント（見本 `.chunk.sel i`）
                          backgroundColor: selX && x >= selX[0] && x < selX[1] ? mark : c.waveBar,
                          borderRadius: 1,
                        }}
                      />
                    );
                  })
                : null}
              {p.selection ? (
                <Animated.View style={[styles.selection, selectionStyle, { borderColor: mark }]} />
              ) : null}
            </View>
            {/* 選択のハンドル。掴んで伸ばす（FR-EDIT-2） */}
            {p.selection && onSelectionChange ? (
              <>
                <GestureDetector gesture={startPan}>
                  <Animated.View style={[styles.handle, styles.handleStart, startStyle]}>
                    <View style={[styles.grip, { backgroundColor: mark }]} />
                  </Animated.View>
                </GestureDetector>
                <GestureDetector gesture={endPan}>
                  <Animated.View style={[styles.handle, styles.handleEnd, endStyle]}>
                    <View style={[styles.grip, { backgroundColor: mark }]} />
                  </Animated.View>
                </GestureDetector>
              </>
            ) : null}
            <View style={[styles.overlayTrack, { top: layersTop }]}>
              {p.overlays.map((o) => {
                if (o.status !== 'placed') return null;
                const music =
                  o.clip.kind === 'bgm' || o.clip.kind === 'opening' || o.clip.kind === 'ending';
                const selected = p.selectedOverlay === o.clip.id;
                const name =
                  p.assetNames?.find((a) => a.id === o.clip.assetId)?.name ??
                  t.assetKinds[o.clip.kind].label;
                return (
                  <Pressable
                    key={o.clip.id}
                    onPress={() => p.onSelectOverlay(o.clip.id)}
                    accessibilityRole="button"
                    accessibilityLabel={t.edit.a11yOverlay(t.assetKinds[o.clip.kind].label, name)}
                    style={[
                      styles.overlayClip,
                      {
                        left: xOf(o.range.start),
                        top: music ? LAYER_H + LAYER_GAP : 0,
                        width: Math.max(6, xOf(o.range.end) - xOf(o.range.start)),
                        backgroundColor: music ? c.musicFill : c.insertFill,
                        // 見本 `.layer` は枠を持たない。選んでいるときだけアクセントの輪郭
                        borderColor: mark,
                        borderWidth: selected ? stroke.selected : 0,
                      },
                    ]}
                  >
                    <Text numberOfLines={1} style={[styles.overlayLabel, { color: c.textPrimary }]}>
                      {name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {p.events.map(({ event, at }) => (
              <View
                key={event.id}
                accessible
                accessibilityLabel={
                  event.kind === 'interruption' ? t.edit.a11yInterruption : t.edit.a11yRouteChange
                }
                style={[styles.event, { left: xOf(at) - icon.sm / 2, top: laneTop }]}
              >
                <Icon
                  name={event.kind === 'interruption' ? 'warning' : 'route'}
                  color={c.mistakeText}
                  size={icon.sm}
                />
              </View>
            ))}
            <View
              pointerEvents="none"
              style={[
                styles.playhead,
                {
                  left: xOf(p.playhead),
                  backgroundColor: c.textPrimary,
                },
              ]}
            >
              {/* 見本 `.playhead::before`: 上端の白い丸 */}
              <View style={[styles.playheadKnob, { backgroundColor: c.textPrimary }]} />
            </View>
          </Pressable>
        </ScrollView>
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  root: { width: '100%' },
  content: { paddingHorizontal: PAD, boxSizing: 'content-box' },
  tick: { position: 'absolute', top: 0, ...typography.tick },
  voiceTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  chunk: { position: 'absolute', top: 0, bottom: 0, borderRadius: radius.xs },
  // 見本 `.chunk.sel`: アクセントの 2 の輪郭（地は塊の側で `accentSubtle`）
  selection: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderWidth: stroke.selected,
    borderRadius: radius.xs,
  },
  handle: {
    position: 'absolute',
    top: RULER + (HEIGHT - hit.min) / 2,
    width: HANDLE_W,
    height: hit.min,
    justifyContent: 'center',
  },
  // つまみ（見本 `.chunk.sel::before` の 6 × 28）の中心を選択の境界に合わせる
  handleStart: { alignItems: 'flex-end', paddingRight: HANDLE_IN - timeline.handleW / 2 },
  handleEnd: { alignItems: 'flex-start', paddingLeft: HANDLE_IN - timeline.handleW / 2 },
  grip: { width: timeline.handleW, height: timeline.handleH, borderRadius: radius.pill },
  overlayTrack: { position: 'absolute', left: 0, right: 0, height: LAYERS_H },
  // 見本 `.layer`: 高さ 24、角丸 4、左右 8、白の 10.5 / 700。
  overlayClip: {
    position: 'absolute',
    height: LAYER_H,
    borderRadius: radius.xs,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  overlayLabel: typography.overline,
  event: { position: 'absolute', alignItems: 'center' },
  // 見本 `.playhead`: 白の 2、目盛りの下から素材のレーンの下まで、上端に 10 の丸。
  playhead: {
    position: 'absolute',
    top: RULER + space.sm,
    height: HEIGHT + LAYERS_TOP + LAYERS_H - space.sm,
    width: space.hair,
    borderRadius: 1,
  },
  playheadKnob: {
    position: 'absolute',
    top: -space.xs,
    left: -space.xs,
    width: space.x10,
    height: space.x10,
    borderRadius: radius.pill,
  },
});
