import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import type { Marker } from '@/domain/editing/doc';
import { formatSmp, smp, type Smp } from '@/domain/time';
import type { PlacedOverlay } from '@/domain/timeline/overlays';
import type { Range, VoiceSegment } from '@/domain/timeline/types';
import { placeVoice } from '@/domain/timeline/voice';
import { useAppTheme } from '@/ui/ThemeContext';

import { sampleVoiceColumns, type TakePeaks } from './peaks';

const SAMPLE_RATE = 48000;
const COL_W = 3;

export interface WaveformProps {
  voice: readonly VoiceSegment[];
  peaksByTake: ReadonlyMap<string, TakePeaks>;
  overlays: readonly PlacedOverlay[];
  markers: readonly { marker: Marker; at: Smp }[];
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
  onMarkerPress: (m: Marker) => void;
  onVoiceSegmentPress?: (index: number) => void;
}

const HEIGHT = 96;
const OVERLAY_H = 22;

/**
 * 声トラック + 素材レイヤーの波形タイムライン（FR-EDIT-8）。
 * 表示中の範囲だけ棒を描く（60 分でも全体を描画しない）。
 */
export const Waveform = memo(function Waveform(p: WaveformProps) {
  const c = useAppTheme();
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

  const seekAt = (x: number) => p.onSeek(smp(Math.max(0, (x / p.pps) * SAMPLE_RATE)));

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
          style={{ width: contentW, height: HEIGHT + OVERLAY_H * 2 + 28 }}
          onPress={(e) => seekAt(e.nativeEvent.locationX)}
        >
          {/* 目盛り */}
          {Array.from({ length: Math.ceil(totalSec / 15) + 2 }).map((_, i) => (
            <Text key={i} style={[styles.tick, { left: i * 15 * p.pps, color: c.ink3 }]}>
              {formatSmp(smp(i * 15 * SAMPLE_RATE))}
            </Text>
          ))}
          {/* 声 */}
          <View style={[styles.voiceTrack, { backgroundColor: c.panel, top: 16 }]}>
            {placed.map((seg, i) => (
              <Pressable
                key={seg.segment.id}
                onPress={() => p.onVoiceSegmentPress?.(i)}
                style={[
                  styles.voiceSeg,
                  {
                    left: xOf(seg.start),
                    width: Math.max(2, xOf(seg.end) - xOf(seg.start)),
                    borderColor: i % 2 ? `${c.voice}55` : `${c.voice}33`,
                  },
                ]}
              />
            ))}
            {columns
              ? Array.from({ length: columns.n }).map((_, i) => {
                  const lo = columns.data[i * 2]! / 127;
                  const hi = columns.data[i * 2 + 1]! / 127;
                  const h = Math.max(1, (hi - lo) * (HEIGHT / 2));
                  const top = HEIGHT / 2 - hi * (HEIGHT / 2);
                  return (
                    <View
                      key={i}
                      style={{
                        position: 'absolute',
                        left: columns.x + i * COL_W,
                        top,
                        width: COL_W - 1,
                        height: h,
                        backgroundColor: c.voice,
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
                    backgroundColor: `${c.rec}33`,
                    borderColor: c.rec,
                  },
                ]}
              />
            ) : null}
            {p.selection ? (
              <View
                style={[
                  styles.selection,
                  {
                    left: xOf(p.selection.start),
                    width: Math.max(2, xOf(p.selection.end) - xOf(p.selection.start)),
                    backgroundColor: `${c.accent}33`,
                    borderColor: c.accent,
                  },
                ]}
              />
            ) : null}
          </View>
          {/* 素材レイヤー */}
          <View style={[styles.overlayTrack, { top: 16 + HEIGHT + 4, backgroundColor: c.panel }]}>
            {p.overlays.map((o) =>
              o.status === 'placed' ? (
                <Pressable
                  key={o.clip.id}
                  onPress={() => p.onSelectOverlay(o.clip.id)}
                  style={[
                    styles.overlayClip,
                    {
                      left: xOf(o.range.start),
                      width: Math.max(6, xOf(o.range.end) - xOf(o.range.start)),
                      backgroundColor:
                        o.clip.kind === 'bgm' ||
                        o.clip.kind === 'opening' ||
                        o.clip.kind === 'ending'
                          ? `${c.music}55`
                          : `${c.insert}66`,
                      borderColor: p.selectedOverlay === o.clip.id ? c.accent : 'transparent',
                    },
                  ]}
                >
                  <Text numberOfLines={1} style={[styles.overlayLabel, { color: c.ink }]}>
                    {o.clip.kind}
                  </Text>
                </Pressable>
              ) : null,
            )}
          </View>
          {/* マーカー */}
          {p.markers.map(({ marker, at }) => (
            <Pressable
              key={marker.id}
              onPress={() => p.onMarkerPress(marker)}
              hitSlop={8}
              style={[styles.marker, { left: xOf(at) - 8 }]}
            >
              <Text
                style={{
                  color: marker.resolved
                    ? c.ink3
                    : marker.kind === 'mistake'
                      ? c.mistake
                      : marker.kind === 'interruption' || marker.kind === 'route_change'
                        ? c.rec
                        : c.accent,
                  fontSize: 12,
                }}
              >
                {marker.kind === 'mistake'
                  ? '⚑'
                  : marker.kind === 'topic'
                    ? '✓'
                    : marker.kind === 'interruption'
                      ? '⏸'
                      : '●'}
              </Text>
            </Pressable>
          ))}
          {/* 再生ヘッド */}
          <View
            pointerEvents="none"
            style={[
              styles.playhead,
              {
                left: xOf(p.recording ? p.total + p.recFrames : p.playhead),
                backgroundColor: p.recording ? c.rec : c.accent,
              },
            ]}
          />
        </Pressable>
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { width: '100%' },
  tick: { position: 'absolute', top: 0, fontSize: 9, fontVariant: ['tabular-nums'] },
  voiceTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: HEIGHT,
    borderRadius: 8,
    overflow: 'hidden',
  },
  voiceSeg: { position: 'absolute', top: 0, bottom: 0, borderLeftWidth: 1 },
  recLive: { position: 'absolute', top: 0, bottom: 0, borderLeftWidth: 1 },
  selection: { position: 'absolute', top: 0, bottom: 0, borderLeftWidth: 2, borderRightWidth: 2 },
  overlayTrack: { position: 'absolute', left: 0, right: 0, height: OVERLAY_H * 2, borderRadius: 8 },
  overlayClip: {
    position: 'absolute',
    top: 2,
    height: OVERLAY_H * 2 - 4,
    borderRadius: 6,
    borderWidth: 1.5,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  overlayLabel: { fontSize: 10, fontWeight: '600' },
  marker: {
    position: 'absolute',
    top: 16 + HEIGHT + 4 + OVERLAY_H * 2 + 4,
    width: 16,
    alignItems: 'center',
  },
  playhead: { position: 'absolute', top: 12, bottom: 0, width: 2, borderRadius: 1 },
});
