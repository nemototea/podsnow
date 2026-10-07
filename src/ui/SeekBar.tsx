import { runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AccessibilityActionEvent } from 'react-native';
import { StyleSheet, View } from 'react-native';

import { formatClock, smp, type Smp } from '@/domain/time';
import { useT } from '@/i18n';

import { IconButton, Text } from './components';
import { PlayButton } from './PlayButton';
import { progressRatio, seekSettled, seekTarget } from './seek';
import { useAppTheme } from './ThemeContext';
import { hit, player, radius, space, tabularNums, typography } from './tokens';

/** 横に何 pt 引いたらシークを始めるか（縦はその 3 倍でシートへ譲る）。 */
const SEEK_SLOP = space.xs;

/** 引く・離す・取り消すの処理。シークバーのジェスチャーは 1 度だけ作るので、固定した関数を渡す。 */
interface SeekHandlers {
  scrub: (x: number) => void;
  commit: (x: number) => void;
  cancel: () => void;
  layout: (width: number) => void;
}

/**
 * シークバーの面。位置（`shown`）は親（`SeekBlock`）が決める（Issue #188）。
 * 位置は 250ms ごとに更新されて描き直されるので、ジェスチャーは `on` が変わらない限り作り直さない
 * （作り直すと引いている途中で取り消されることがある）。
 */
function SeekBar({
  value,
  shown,
  max,
  on,
  onStep,
}: {
  /** 実際の再生位置。読み上げに使う。 */
  value: Smp;
  /** つまみの位置。引いている間・離した直後は実際の位置と違う。 */
  shown: Smp;
  max: Smp;
  on: SeekHandlers;
  /** 読み上げの「増やす / 減らす」。 */
  onStep: (to: Smp) => void;
}) {
  const c = useAppTheme();
  const t = useT();
  const gesture = useMemo(
    () =>
      Gesture.Race(
        Gesture.Tap().onEnd((e, ok) => {
          if (ok) runOnJS(on.commit)(e.x);
        }),
        // 横に引いたときだけシークする。縦はシートを下へ引いて閉じる操作に譲る（Issue #188）
        Gesture.Pan()
          .activeOffsetX([-SEEK_SLOP, SEEK_SLOP])
          .failOffsetY([-SEEK_SLOP * 3, SEEK_SLOP * 3])
          .onUpdate((e) => runOnJS(on.scrub)(e.x))
          .onEnd((e, ok) => {
            if (ok) runOnJS(on.commit)(e.x);
          })
          .onFinalize((_e, ok) => {
            if (!ok) runOnJS(on.cancel)();
          }),
      ),
    [on],
  );
  const ratio = progressRatio(shown, max);
  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    const step = 5 * 48000;
    if (e.nativeEvent.actionName === 'increment') onStep(smp(Math.min(max, value + step)));
    if (e.nativeEvent.actionName === 'decrement') onStep(smp(Math.max(0, value - step)));
  };
  return (
    <GestureDetector gesture={gesture}>
      <View
        style={s.seekHit}
        onLayout={(e) => on.layout(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t.player.seek}
        accessibilityValue={{ min: 0, max, now: value, text: formatClock(value) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAccessibilityAction}
      >
        {/* 見本のミニプレーヤーの進み具合（`.mini .bar`）と同じ作法: 細い地に白の進み、白い丸のつまみ。 */}
        <View style={[s.track, { backgroundColor: c.surfaceHover }]}>
          <View style={[s.fill, { width: `${ratio * 100}%`, backgroundColor: c.textPrimary }]} />
          <View style={[s.thumb, { left: `${ratio * 100}%`, backgroundColor: c.textPrimary }]} />
        </View>
      </View>
    </GestureDetector>
  );
}

/**
 * シークバーと時刻、読み込み中・失敗の文言（Issue #188）。引いている間はつまみと時刻だけ動かし、
 * 指を離したときに 1 回だけ `onSeek` を呼ぶ（引くたびにシークすると音が細切れになり、つまみが
 * 実際の位置へ引き戻される）。離したあとは、実際の位置が追いつくまで離した位置を出す。
 */
export function SeekBlock({
  position,
  duration,
  loading = false,
  loadingLabel,
  errorMessage = null,
  onSeek,
}: {
  position: Smp;
  duration: Smp;
  loading?: boolean;
  loadingLabel?: string | undefined;
  errorMessage?: string | null;
  onSeek: (to: Smp) => void;
}) {
  const c = useAppTheme();
  const [drag, setDrag] = useState<Smp | null>(null);
  const [hold, setHold] = useState<Smp | null>(null);
  // 留めるのは上限の時間まで。シークが失敗して位置が動かなくても、実際の位置へ戻す
  useEffect(() => {
    if (hold === null) return;
    const timer = setTimeout(() => setHold(null), player.seekSettleMs);
    return () => clearTimeout(timer);
  }, [hold]);
  // 最新の値は ref から読む。シークバーへ渡す関数を固定するため（`ReorderList` と同じ）。
  const width = useRef(1);
  const latest = useRef({ duration, onSeek });
  useLayoutEffect(() => {
    latest.current = { duration, onSeek };
  });
  const on = useMemo<SeekHandlers>(
    () => ({
      scrub: (x) => setDrag(seekTarget(x, width.current, latest.current.duration)),
      commit: (x) => {
        const to = seekTarget(x, width.current, latest.current.duration);
        setDrag(null);
        setHold(to);
        latest.current.onSeek(to);
      },
      cancel: () => setDrag(null),
      layout: (w) => {
        width.current = w;
      },
    }),
    [],
  );
  const at = drag ?? (hold !== null && !seekSettled(position, hold) ? hold : position);
  return (
    <View style={s.seekBlock}>
      <SeekBar value={position} shown={at} max={duration} on={on} onStep={onSeek} />
      <View style={s.times}>
        <Text style={[typography.numeric, tabularNums, { color: c.textSecondary }]}>
          {formatClock(at)}
        </Text>
        <Text style={[typography.numeric, tabularNums, { color: c.textSecondary }]}>
          −{formatClock(smp(Math.max(0, duration - at)))}
        </Text>
      </View>
      {errorMessage || (loading && loadingLabel) ? (
        <Text
          style={[
            typography.caption,
            s.status,
            { color: errorMessage ? c.dangerText : c.textSecondary },
          ]}
          accessibilityLiveRegion="polite"
        >
          {errorMessage ?? loadingLabel}
        </Text>
      ) : null}
    </View>
  );
}

/** 15 秒戻る・再生 / 一時停止・30 秒進む。再生は大きい丸（Issue #171 D5）。 */
export function PlayerControls({
  position,
  duration,
  playing,
  loading = false,
  failed = false,
  onToggle,
  onSeek,
}: {
  position: Smp;
  duration: Smp;
  playing: boolean;
  loading?: boolean;
  /** 読み込みに失敗している。再生ボタンは「読み込み直す」になる。 */
  failed?: boolean;
  onToggle: () => void;
  onSeek: (to: Smp) => void;
}) {
  const t = useT();
  return (
    <View style={s.controls}>
      <IconButton
        name="skipBack15"
        label={t.player.rewind}
        onPress={() => onSeek(smp(Math.max(0, position - 15 * 48000)))}
      />
      <PlayButton
        name={failed ? 'refresh' : playing ? 'pause' : 'play'}
        label={failed ? t.player.retry : playing ? t.a11y.pause : t.a11y.play}
        busy={loading}
        onPress={onToggle}
      />
      <IconButton
        name="skipForward30"
        label={t.player.forward}
        onPress={() => onSeek(smp(Math.min(duration, position + 30 * 48000)))}
      />
    </View>
  );
}

const s = StyleSheet.create({
  seekBlock: { width: '100%' },
  seekHit: { minHeight: hit.min, justifyContent: 'center' },
  track: { height: player.seekTrack, borderRadius: radius.pill },
  fill: { height: '100%', borderRadius: radius.pill },
  thumb: {
    position: 'absolute',
    width: player.seekThumb,
    height: player.seekThumb,
    marginLeft: -player.seekThumb / 2,
    marginTop: -(player.seekThumb - player.seekTrack) / 2,
    borderRadius: radius.pill,
  },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  status: { textAlign: 'center', marginTop: space.sm },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.xl },
});
