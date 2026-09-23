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

import type { OutlineItem } from '@/domain/outline';
import { formatSmp, smp, type Smp } from '@/domain/time';
import type { PlacedOverlay } from '@/domain/timeline/overlays';
import type { Range, VoiceSegment } from '@/domain/timeline/types';
import { snapToBoundary } from '@/domain/timeline/blocks';
import { placeVoice } from '@/domain/timeline/voice';
import { useT } from '@/i18n';
import type { RecordingEvent } from '@/infra/db/repositories/recordingEventsRepo';
import { Icon, Text } from '@/ui/components';
import {
  concentric,
  glyphSlop,
  hit,
  icon,
  radius,
  space,
  stroke,
  tabularNums,
  typography,
} from '@/ui/tokens';
import { useAppTheme } from '@/ui/ThemeContext';

import { sampleVoiceColumns, type TakePeaks } from './peaks';

const SAMPLE_RATE = 48000;
const COL_W = 3;

export interface WaveformProps {
  voice: readonly VoiceSegment[];
  peaksByTake: ReadonlyMap<string, TakePeaks>;
  overlays: readonly PlacedOverlay[];
  assetNames?: readonly { id: string; name: string }[];
  /** トークテーマ由来のチャプター（FR-OUT-4）。ユーザーは打たない。 */
  chapters: readonly { item: OutlineItem; at: Smp }[];
  /** 割り込みなど、アプリが記録した位置（DATA_MODEL.md §4.10）。 */
  events: readonly { event: RecordingEvent; at: Smp }[];
  total: Smp;
  playhead: Smp;
  selection: Range | null;
  selectedOverlay: string | null;
  /** 1 秒あたりのピクセル。 */
  pps: number;
  recording: boolean;
  recFrames: number;
  onSeek: (to: Smp) => void;
  onSelectOverlay: (id: string | null) => void;
  onChapterPress: (item: OutlineItem) => void;
  /** チャプターを長押ししたとき。そのチャプターを丸ごと選ぶ。 */
  onChapterLongPress?: (item: OutlineItem) => void;
  /** 録音タブ用の低い表示。収録中は波形より読む内容に高さを使う（§5.1）。 */
  compact?: boolean;
  /** 無音で区切られた声の塊（FR-EDIT-2）。タップで選び、ハンドルで広げる。 */
  blocks?: readonly Range[];
  /** 塊をタップしたとき。指定すると、タップはシークではなく選択になる。 */
  onSelectBlock?: (at: Smp) => void;
  /** ハンドルのドラッグを確定したとき。 */
  onSelectionChange?: (range: Range) => void;
}

const HANDLE_W = 28;
const EMPTY_BLOCKS: readonly Range[] = [];
const FULL_HEIGHT = 96;
const COMPACT_HEIGHT = 44;
const OVERLAY_H = 22;

/**
 * 声トラック + 素材レイヤーの波形タイムライン（FR-EDIT-8）。
 * 表示中の範囲だけ棒を描く（60 分でも全体を描画しない）。
 */
export const Waveform = memo(function Waveform(p: WaveformProps) {
  const c = useAppTheme();
  const t = useT();
  const mark = c.isDark ? c.accentSolid : c.accentBorder;
  const height = p.compact ? COMPACT_HEIGHT : FULL_HEIGHT;
  const laneTop = 16 + height + 4 + OVERLAY_H * 2 + 4;
  const [viewW, setViewW] = useState(0);
  const [scrollX, setScrollX] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const totalSec = (p.total + (p.recording ? p.recFrames : 0)) / SAMPLE_RATE;
  const contentW = Math.max(viewW, totalSec * p.pps + viewW);
  const onLayout = useCallback((e: LayoutChangeEvent) => setViewW(e.nativeEvent.layout.width), []);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => setScrollX(e.nativeEvent.contentOffset.x),
    [],
  );

  // 可視範囲（前後 1 画面分の余裕）
  const from = Math.max(0, scrollX - viewW);
  const to = Math.min(contentW, scrollX + viewW * 2);
  const columns = useMemo(() => {
    if (viewW === 0) return null;
    const n = Math.ceil((to - from) / COL_W);
    const fromSmp = Math.floor((from / p.pps) * SAMPLE_RATE);
    const toSmp = Math.floor((to / p.pps) * SAMPLE_RATE);
    return { x: from, n, data: sampleVoiceColumns(p.voice, p.peaksByTake, fromSmp, toSmp, n) };
  }, [from, to, viewW, p.pps, p.voice, p.peaksByTake]);

  const xOf = (s: number) => (s / SAMPLE_RATE) * p.pps;
  const placed = useMemo(() => placeVoice(p.voice), [p.voice]);

  const seekAt = (x: number) => {
    if (!Number.isFinite(x)) return;
    const at = smp(Math.max(0, (x / p.pps) * SAMPLE_RATE));
    if (p.onSelectBlock) p.onSelectBlock(at);
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

  const commit = useCallback(
    (a: number, b: number) => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      // 隣の塊の切れ目に吸い付かせる（画面 12px 相当）
      const within = (12 / pps) * SAMPLE_RATE;
      p.onSelectionChange?.({
        start: snapToBoundary(blocks, smp(lo), within),
        end: snapToBoundary(blocks, smp(hi), within),
      });
    },
    [blocks, p, pps],
  );

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
        })
        .onEnd(() => {
          runOnJS(commit)(selStart.value, selEnd.value);
        }),
    [commit, pps, selEnd, selStart, startBase],
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
        })
        .onEnd(() => {
          runOnJS(commit)(selStart.value, selEnd.value);
        }),
    [commit, endBase, pps, selEnd, selStart, total],
  );

  const selectionStyle = useAnimatedStyle(() => ({
    left: (selStart.value / SAMPLE_RATE) * pps,
    width: Math.max(2, ((selEnd.value - selStart.value) / SAMPLE_RATE) * pps),
  }));
  const startStyle = useAnimatedStyle(() => ({
    left: (selStart.value / SAMPLE_RATE) * pps - HANDLE_W / 2,
  }));
  const endStyle = useAnimatedStyle(() => ({
    left: (selEnd.value / SAMPLE_RATE) * pps - HANDLE_W / 2,
  }));

  return (
    <View onLayout={onLayout} style={styles.root}>
      <ScrollView
        ref={scrollRef}
        horizontal
        onScroll={onScroll}
        scrollEventThrottle={32}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ width: contentW }}
      >
        <Pressable
          style={{ width: contentW, height: height + OVERLAY_H * 2 + 52 }}
          onPress={(e) => seekAt(e.nativeEvent.locationX)}
        >
          {/* 目盛り */}
          {Array.from({ length: Math.ceil(totalSec / 15) + 2 }).map((_, i) => (
            <Text
              key={i}
              style={[styles.tick, tabularNums, { left: i * 15 * p.pps, color: c.textTertiary }]}
            >
              {formatSmp(smp(i * 15 * SAMPLE_RATE))}
            </Text>
          ))}
          {/* 声 */}
          <View style={[styles.voiceTrack, { top: 16, height }]}>
            {placed.map((seg, i) => (
              <View
                key={seg.segment.id}
                pointerEvents="none"
                style={[
                  styles.voiceSeg,
                  {
                    left: xOf(seg.start),
                    width: Math.max(2, xOf(seg.end) - xOf(seg.start)),
                    borderColor: i % 2 ? c.voiceFillAlt : c.voiceFill,
                  },
                ]}
              />
            ))}
            {columns
              ? Array.from({ length: columns.n }).map((_, i) => {
                  const lo = columns.data[i * 2]! / 127;
                  const hi = columns.data[i * 2 + 1]! / 127;
                  const h = Math.max(1, (hi - lo) * (height / 2));
                  const top = height / 2 - hi * (height / 2);
                  return (
                    <View
                      key={i}
                      style={{
                        position: 'absolute',
                        left: columns.x + i * COL_W,
                        top,
                        width: COL_W - 1,
                        height: h,
                        backgroundColor: c.voiceSolid,
                        borderRadius: 1,
                      }}
                    />
                  );
                })
              : null}
            {p.recording ? (
              <View
                style={[
                  styles.recLive,
                  {
                    left: xOf(p.total),
                    width: Math.max(4, xOf(p.recFrames)),
                    backgroundColor: c.recordingOverlay,
                    borderColor: c.recSolid,
                  },
                ]}
              />
            ) : null}
            {/* 塊の切れ目。選べる単位が目で分かるようにする */}
            {p.blocks?.map((b) => (
              <View
                key={`${b.start}-${b.end}`}
                style={[styles.blockEdge, { left: xOf(b.start), borderColor: c.borderStrong }]}
              />
            ))}
            {p.selection ? (
              <Animated.View
                style={[
                  styles.selection,
                  selectionStyle,
                  { backgroundColor: c.selectionOverlay, borderColor: mark },
                ]}
              />
            ) : null}
          </View>
          {/* 選択のハンドル。掴んで伸ばす（FR-EDIT-2） */}
          {p.selection && p.onSelectionChange ? (
            <>
              <GestureDetector gesture={startPan}>
                <Animated.View style={[styles.handle, startStyle]}>
                  <View style={[styles.grip, { backgroundColor: mark }]} />
                </Animated.View>
              </GestureDetector>
              <GestureDetector gesture={endPan}>
                <Animated.View style={[styles.handle, endStyle]}>
                  <View style={[styles.grip, { backgroundColor: mark }]} />
                </Animated.View>
              </GestureDetector>
            </>
          ) : null}
          <View style={[styles.overlayTrack, { top: 16 + height + 4 }]}>
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
                      width: Math.max(6, xOf(o.range.end) - xOf(o.range.start)),
                      backgroundColor: music ? c.musicFill : c.insertFill,
                      borderColor: selected ? mark : music ? c.musicBorder : c.insertBorder,
                      borderWidth: selected ? stroke.selected : stroke.hairline,
                    },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[styles.overlayLabel, { color: music ? c.musicText : c.insertText }]}
                  >
                    {name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {p.chapters.map(({ item, at }) => (
            <Pressable
              key={item.id}
              onPress={() => p.onChapterPress(item)}
              onLongPress={() => p.onChapterLongPress?.(item)}
              hitSlop={glyphSlop}
              accessibilityRole="button"
              accessibilityLabel={t.edit.a11yChapter(item.heading)}
              accessibilityHint={t.edit.a11yChapterHint}
              style={[styles.chapter, { left: xOf(at), top: laneTop }]}
            >
              <View style={[styles.chapterTick, { backgroundColor: c.textSecondary }]} />
              <Text
                numberOfLines={1}
                style={[typography.overline, { color: c.textSecondary, flexShrink: 1 }]}
              >
                {item.heading}
              </Text>
            </Pressable>
          ))}
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
                name={event.kind === 'interruption' ? 'pause' : 'warning'}
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
                left: xOf(p.recording ? p.total + p.recFrames : p.playhead),
                backgroundColor: p.recording ? c.recSolid : mark,
              },
            ]}
          />
        </Pressable>
      </ScrollView>
      {p.compact ? null : (
        <>
          <Text
            pointerEvents="none"
            style={[styles.lane, styles.laneRight, { top: 0, color: c.textSecondary }]}
          >
            {t.edit.laneVoice}
          </Text>
          <Text
            pointerEvents="none"
            style={[
              styles.lane,
              styles.laneLeft,
              { top: 16 + height + 4 + space.xs, color: c.textSecondary },
            ]}
          >
            {p.overlays.some((o) => o.status === 'placed')
              ? t.edit.laneAssets
              : t.edit.laneAssetsEmpty}
          </Text>
        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { width: '100%' },
  lane: { position: 'absolute', ...typography.overline },
  laneLeft: { left: space.sm },
  laneRight: { right: space.sm },
  tick: { position: 'absolute', top: 0, ...typography.tick },
  voiceTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  voiceSeg: { position: 'absolute', top: 0, bottom: 0, borderLeftWidth: 1 },
  recLive: { position: 'absolute', top: 0, bottom: 0, borderLeftWidth: 1 },
  selection: { position: 'absolute', top: 0, bottom: 0, borderLeftWidth: 2, borderRightWidth: 2 },
  blockEdge: { position: 'absolute', top: 0, bottom: 0, width: 1, borderLeftWidth: 1 },
  handle: {
    position: 'absolute',
    top: 16,
    width: HANDLE_W,
    height: hit.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grip: { width: space.xs, height: space.xxl, borderRadius: radius.pill },
  overlayTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: OVERLAY_H * 2,
    borderRadius: radius.sm,
  },
  overlayClip: {
    position: 'absolute',
    top: space.hair,
    height: OVERLAY_H * 2 - space.xs,
    // 外側 radius.sm の内側に space.hair で入るので、同心になる角丸はこれ。
    borderRadius: concentric(radius.sm, space.hair),
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  overlayLabel: typography.overline,
  chapter: {
    position: 'absolute',
    maxWidth: 140,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  chapterTick: { width: stroke.selected, height: space.md },
  event: { position: 'absolute', alignItems: 'center' },
  playhead: { position: 'absolute', top: space.md, bottom: 0, width: space.hair, borderRadius: 1 },
});
