import { runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AccessibilityActionEvent } from 'react-native';
import { StyleSheet, View } from 'react-native';

import { formatClock, smp, type Smp } from '@/domain/time';
import { useT } from '@/i18n';

import { IconButton, Text } from './components';
import { Cassette, Jacket } from './media';
import { PlayButton } from './PlayButton';
import { progressRatio, seekSettled, seekTarget } from './seek';
import { useAppTheme } from './ThemeContext';
import { artwork, hit, player, radius, space, stroke, tabularNums, typography } from './tokens';

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
        <View style={[s.track, { backgroundColor: c.surface, borderColor: c.controlBorder }]}>
          <View style={[s.fill, { width: `${ratio * 100}%`, backgroundColor: c.accentSolid }]} />
          <View
            style={[
              s.thumb,
              {
                left: `${ratio * 100}%`,
                backgroundColor: c.brandAccent,
                borderColor: c.controlBorder,
              },
            ]}
          />
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

/**
 * 再生の見立て（DESIGN_SYSTEM.md §2.6）。編集中のタイムライン（`timeline`）はカセット、
 * 書き出したファイル・配信中の音声（`export` / `rss`）はレコードジャケット（#203）。
 */
export type PlayerMedium = 'tape' | 'disc';

export function EpisodePlayer({
  medium,
  artworkUri,
  showName,
  title,
  episodeNumber,
  position,
  duration,
  playing,
  loading = false,
  loadingLabel,
  errorMessage = null,
  onToggle,
  onSeek,
}: {
  medium: PlayerMedium;
  artworkUri: string | null;
  /** アートワークが無いときのジャケットの表紙に使う（Issue #193）。 */
  showName?: string | undefined;
  title: string;
  episodeNumber: number | null;
  position: Smp;
  duration: Smp;
  playing: boolean;
  /** 音声の読み込み・バッファ待ち（Issue #185）。再生ボタンが回転表示になる。 */
  loading?: boolean;
  loadingLabel?: string | undefined;
  /** 読み込みに失敗した理由と次の操作。出ている間、再生ボタンは「読み込み直す」になる。 */
  errorMessage?: string | null;
  onToggle: () => void;
  onSeek: (to: Smp) => void;
}) {
  const c = useAppTheme();
  const t = useT();
  const [width, setWidth] = useState(0);
  const code = episodeNumber === null ? null : t.episode.number(episodeNumber);
  return (
    <View style={s.player} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {medium === 'tape' ? (
        width > 0 ? (
          <Cassette
            width={Math.min(width - space.sm, CASSETTE_MAX)}
            progress={duration > 0 ? position / duration : 0}
            playing={playing}
            title={title || t.home.untitled}
            code={code}
          />
        ) : null
      ) : (
        <Jacket
          uri={artworkUri}
          name={showName}
          size={artwork.player}
          playing={playing}
          label={t.player.artwork}
        />
      )}
      <View style={s.titleBlock}>
        <Text
          style={[typography.heading, { color: title ? c.textPrimary : c.textSecondary }]}
          numberOfLines={2}
        >
          {title || t.home.untitled}
        </Text>
        {code === null ? null : (
          <Text style={[typography.numeric, { color: c.accentText }]}>{code}</Text>
        )}
      </View>
      <SeekBlock
        position={position}
        duration={duration}
        loading={loading}
        loadingLabel={loadingLabel}
        errorMessage={errorMessage}
        onSeek={onSeek}
      />
      <PlayerControls
        position={position}
        duration={duration}
        playing={playing}
        loading={loading}
        failed={!!errorMessage}
        onToggle={onToggle}
        onSeek={onSeek}
      />
    </View>
  );
}

/** カセットの原寸（DESIGN_SYSTEM.md §2.6）。広い画面でもこれより大きくしない。 */
export const CASSETTE_MAX = 358;

const s = StyleSheet.create({
  player: { alignItems: 'center', gap: space.lg },
  titleBlock: { alignItems: 'center', gap: space.xs },
  seekBlock: { width: '100%' },
  seekHit: { minHeight: hit.min, justifyContent: 'center' },
  track: { height: player.seekTrack, borderRadius: radius.pill, borderWidth: stroke.selected },
  fill: { height: '100%', borderRadius: radius.pill },
  thumb: {
    position: 'absolute',
    width: player.seekThumb,
    height: player.seekThumb,
    marginLeft: -player.seekThumb / 2,
    // 線の内側（高さ seekTrack − 線 2 本）の中心に置く
    marginTop: -(player.seekThumb - (player.seekTrack - stroke.selected * 2)) / 2,
    borderRadius: radius.pill,
    borderWidth: stroke.selected,
  },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  status: { textAlign: 'center', marginTop: space.sm },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.xl },
});
