import { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { compositeHex, type ShowColors } from '@/domain/color/showColors';
import { formatClock, formatSmp, smp } from '@/domain/time';
import { useT, type Messages } from '@/i18n';
import type { AssetRow } from '@/infra/db/repositories/assetsRepo';
import type { SessionState } from '@/services/recording/RecordingSession';
import { Icon, IconButton, Pill, Row, Text, useCompact } from '@/ui/components';
import { LevelBars } from '@/ui/LevelBars';
import { Sheet } from '@/ui/Sheet';
import { ShowGradient } from '@/ui/ShowGradient';
import { useAppTheme } from '@/ui/ThemeContext';
import {
  gutterNowPlaying,
  hit,
  icon,
  motion,
  pressScale,
  radius,
  recordView,
  space,
  typography,
} from '@/ui/tokens';
import { TopicCard } from '@/ui/TopicCard';

import { liveColumns, type LivePeak } from './livePeaks';
import { storageLine } from './storageLine';
import { TopicsSheet } from './TopicsSheet';
import type { RecordingContext } from './useRecordingContext';
import type { Workspace } from './useWorkspace';

/** 番組の色の上の白の濃さ（見本 `.np .head small` 75%、`.np .title span` / `.clock span` 72%、`.wavebox .chap` 85%）。 */
const HEAD_ALPHA = 0.75;
const SUB_ALPHA = 0.72;
const CHAP_ALPHA = 0.85;
/** 波形のパネルの地（見本 `.wavebox` の黒 28%）と、ジングルの押しボタンの地（`.pads button` の白 12%）。 */
const PANEL_ALPHA = 0.28;
const PAD_ALPHA = 0.12;
/** ライブ波形の本数（見本の 90）と、白の濃さ（古い棒 35% → 新しい棒 85%、最後の 3 本は白）。 */
const LIVE_BARS = 90;
const LIVE_FADE_FROM = 0.35;
const LIVE_FADE_SPAN = 0.5;
const LIVE_SOLID = 3;
/** 1 本あたりの時間（見本の 110ms）。 */
const LIVE_STEP_FRAMES = 0.11 * 48000;

function stateText(t: Messages, s: SessionState): string {
  switch (s) {
    case 'paused':
      return t.record.statePaused;
    case 'interrupted':
      return t.record.stateInterrupted;
    case 'preparing':
      return t.record.statePreparing;
    case 'stopping':
      return t.record.stateStopping;
    default:
      return t.record.stateRecording;
  }
}

/**
 * 録っている間の波形（見本 `.wavebox canvas`）。直近の level のピークを 90 本の棒にして、
 * 新しいほど白く描く。表示だけで触れない。
 */
function LiveWave({ peaks, panel }: { peaks: readonly LivePeak[]; panel: string }) {
  const c = useAppTheme();
  const [size, setSize] = useState({ w: 0, h: 0 });
  // `useLivePeaks` は同じ配列の末尾に足していくので、末尾の位置で描き直す
  const end = peaks.length ? peaks[peaks.length - 1]!.frames : 0;
  const amps = useMemo(
    () => liveColumns(peaks, end - LIVE_BARS * LIVE_STEP_FRAMES, end, LIVE_BARS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [peaks, end, peaks.length],
  );
  const colors = useMemo(
    () =>
      Array.from({ length: LIVE_BARS }, (_, k) =>
        k >= LIVE_BARS - LIVE_SOLID
          ? c.textPrimary
          : compositeHex(c.textPrimary, LIVE_FADE_FROM + (LIVE_FADE_SPAN * k) / LIVE_BARS, panel),
      ),
    [c.textPrimary, panel],
  );
  const step = size.w / LIVE_BARS;
  const bw = Math.max(1.5, step * 0.55);
  const usable = Math.max(0, size.h - recordView.waveInset);
  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={(e: LayoutChangeEvent) =>
        setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }
    >
      {size.w > 0
        ? Array.from(amps, (a, k) => {
            const bh = Math.max(2, a * usable);
            return (
              <View
                key={k}
                style={{
                  position: 'absolute',
                  left: k * step + (step - bw) / 2,
                  top: size.h / 2 + recordView.waveShift - bh / 2,
                  width: bw,
                  height: bh,
                  borderRadius: bw / 2,
                  backgroundColor: colors[k],
                }}
              />
            );
          })
        : null}
    </View>
  );
}

/** ジングル・効果音の押しボタン（見本 `.pads button`）。押した瞬間だけ白くなる。 */
function Pad({
  label,
  iconName,
  bg,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  iconName: 'music' | 'plus';
  bg: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const c = useAppTheme();
  const [hitAt, setHitAt] = useState(0);
  useEffect(() => {
    if (!hitAt) return;
    const id = setTimeout(() => setHitAt(0), motion.colorFade - motion.quick);
    return () => clearTimeout(id);
  }, [hitAt]);
  const on = hitAt > 0;
  const fg = on ? c.inverseText : c.textPrimary;
  return (
    <Pressable
      onPress={() => {
        setHitAt(Date.now());
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[st.pad, { backgroundColor: on ? c.inverseSurface : bg }]}
    >
      <Icon name={iconName} color={fg} size={icon.inline} />
      <Text style={[typography.captionStrong, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * 収録タブの録音中（見本 3.「収録」、DESIGN_SYSTEM.md §8）。画面全体を番組の色のグラデーションにし、
 * 上から 閉じる・状態・番組名 → ライブ波形 → 題 → 時間とレベル → トークテーマのカード → ジングル → 操作バー。
 * 録音中は戻れない（閉じるは理由を伝えるだけ）。録音ボタンは位置を動かさない（#128）。
 */
export function RecordingView({
  ws,
  recCtx,
  colors,
  showName,
  title,
  livePeaks,
  onToggleRec,
  onFinishInterrupted,
  onInsertAsset,
  onLockedBack,
}: {
  ws: Workspace;
  recCtx: RecordingContext;
  colors: ShowColors;
  showName: string;
  /** 「#43 寝る前に読む本」。 */
  title: string;
  livePeaks: readonly LivePeak[];
  onToggleRec: () => void;
  onFinishInterrupted: () => void;
  onInsertAsset: (a: AssetRow) => void;
  onLockedBack: () => void;
}) {
  const c = useAppTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const compact = useCompact();
  const { state } = ws;
  const s = state.recording;
  const active = s === 'recording' || s === 'paused';
  const interrupted = s === 'interrupted';
  const busy = s === 'preparing' || s === 'stopping';
  const [topics, setTopics] = useState<{ open: boolean; focus: string | null }>({
    open: false,
    focus: null,
  });
  const [assetsOpen, setAssetsOpen] = useState(false);

  const top = colors.nowPlaying;
  const head = compositeHex(c.textPrimary, HEAD_ALPHA, top);
  const sub = compositeHex(c.textPrimary, SUB_ALPHA, top);
  const panel = compositeHex(c.inverseText, PANEL_ALPHA, top);
  const chap = compositeHex(c.textPrimary, CHAP_ALPHA, panel);
  const padBg = compositeHex(c.textPrimary, PAD_ALPHA, colors.nowPlayingMid);

  const outline = state.outline;
  const currentIndex = ws.outlineCurrent;
  const current = currentIndex === null ? null : (outline[currentIndex] ?? null);
  const nextIndex = ws.outlineNext;
  const next = nextIndex === null ? null : (outline[nextIndex] ?? null);
  const favorites = state.assets.filter(
    (a) => a.is_favorite && (a.kind === 'jingle' || a.kind === 'sfx'),
  );
  const inputName = recCtx.inputKnown
    ? (recCtx.input?.name ?? t.record.builtInMic)
    : t.record.inputUnknown;
  const db =
    s === 'recording' && state.level && Number.isFinite(state.level.peakDb)
      ? Math.round(state.level.peakDb)
      : null;
  const clock = formatClock(smp(state.recFrames));
  const where =
    state.recAt === null ? t.record.appendAtEnd : t.record.insertAtPosition(formatSmp(state.recAt));

  const advance = () =>
    void ws.advanceOutline().then(
      // 画面の通知は出さない（カードが替わるので見て分かる）。読み上げにだけ伝える
      (it) => it && AccessibilityInfo.announceForAccessibility(t.record.a11yAdvanced(it.heading)),
    );

  return (
    <View style={st.root}>
      <ShowGradient
        stops={[
          [colors.nowPlaying, 0],
          [colors.nowPlayingMid, 0.55],
          [colors.nowPlayingEnd, 1],
        ]}
      />
      <View
        style={[
          st.np,
          {
            paddingTop: insets.top + space.xs,
            paddingBottom: insets.bottom + space.x22,
            paddingHorizontal: gutterNowPlaying,
          },
        ]}
      >
        {/* 見本 `.np .head` */}
        <View style={st.head}>
          <IconButton
            name="chevron"
            color={c.textPrimary}
            label={t.record.close}
            onPress={onLockedBack}
          />
          <View style={st.headText} accessibilityLiveRegion="polite">
            <Text style={[typography.eyebrow, { color: head }]}>{stateText(t, s)}</Text>
            <Text style={[typography.chipStrong, { color: c.textPrimary }]} numberOfLines={1}>
              {showName}
            </Text>
          </View>
          <IconButton
            name="more"
            color={c.textPrimary}
            label={t.record.a11yMenuLocked}
            disabled
            onPress={() => undefined}
          />
        </View>

        <ScrollView
          style={st.flex}
          contentContainerStyle={st.body}
          showsVerticalScrollIndicator={false}
        >
          {/* 見本 `.wavebox` */}
          <View style={[st.wave, { backgroundColor: panel }]}>
            <LiveWave peaks={livePeaks} panel={panel} />
            <View style={st.chap}>
              {s === 'recording' ? <Pill label={t.record.recPill} kind="rec" /> : null}
              <Text style={[typography.meta, st.flex, { color: chap }]} numberOfLines={1}>
                {current && currentIndex !== null
                  ? t.record.chapterTag(currentIndex + 1, current.heading)
                  : t.record.takeLabel(state.takes.length + 1)}
              </Text>
            </View>
          </View>

          {/* 見本 `.np .title` */}
          <View>
            <Text style={[typography.nowPlaying, { color: c.textPrimary }]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[typography.body, { color: sub }]} numberOfLines={1}>
              {`${t.record.takeLabel(state.takes.length + 1)} · ${where}`}
            </Text>
          </View>

          {/* 見本 `.clock` と `.meter` */}
          <View style={st.levels}>
            <View style={st.clock}>
              <Text
                style={[
                  compact ? typography.timerCompact : typography.timer,
                  { color: c.textPrimary },
                ]}
                accessibilityLabel={t.record.a11yElapsed(clock)}
              >
                {clock}
              </Text>
              <View style={st.input}>
                <Icon
                  name={recCtx.input?.type === 'builtin' || !recCtx.input ? 'mic' : 'headphones'}
                  color={sub}
                  size={icon.inline}
                />
                <Text style={[typography.small, st.shrink, { color: sub }]} numberOfLines={1}>
                  {db === null ? inputName : `${inputName} · ${t.record.levelDb(db)}`}
                </Text>
              </View>
            </View>
            <LevelBars
              db={s === 'recording' ? (state.level?.peakDb ?? null) : null}
              background={colors.nowPlaying}
              accessibilityLabel={db === null ? t.record.a11yLevelIdle : t.record.a11yLevel(db)}
            />
            {state.level?.clipped ? (
              <Text style={[typography.small, { color: c.textPrimary }]}>{t.record.clipped}</Text>
            ) : null}
            <Text
              style={[
                typography.small,
                { color: active && !recCtx.writerOk ? c.textPrimary : sub },
              ]}
            >
              {storageLine(t, recCtx, active)}
            </Text>
          </View>

          {/* 見本 `.topic`（DESIGN_SYSTEM.md §2.7） */}
          {outline.length ? (
            <TopicCard
              color={colors.topicCard}
              heading={t.record.talkingPoints}
              counter={
                currentIndex === null
                  ? t.record.progress(0, outline.length)
                  : `${currentIndex + 1} / ${outline.length}`
              }
              title={(current ?? next ?? outline[0]!).heading}
              next={
                current
                  ? next
                    ? t.record.nextMakesChapter(next.heading)
                    : undefined
                  : t.record.notStarted
              }
              onPress={() => setTopics({ open: true, focus: current?.id ?? null })}
              accessibilityLabel={`${t.record.talkingNow}, ${(current ?? next ?? outline[0]!).heading}`}
            />
          ) : (
            <TopicCard
              color={colors.topicCard}
              heading={t.record.talkingPoints}
              title={t.record.addTopics}
              onPress={() => setTopics({ open: true, focus: null })}
              accessibilityLabel={t.record.addTopics}
            />
          )}

          {/* 見本 `.pads` */}
          {state.assets.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={st.pads}
            >
              {favorites.map((a) => (
                <Pad
                  key={a.id}
                  label={a.name}
                  iconName="music"
                  bg={padBg}
                  accessibilityLabel={t.record.a11yInsertNow(a.name)}
                  onPress={() => onInsertAsset(a)}
                />
              ))}
              <Pad
                label={t.record.moreAssets}
                iconName="plus"
                bg={padBg}
                accessibilityLabel={t.record.moreAssets}
                onPress={() => setAssetsOpen(true)}
              />
            </ScrollView>
          ) : null}
        </ScrollView>

        {/* 見本 `.transport`: 取り消す・一時停止・録音の丸・次へ・一覧 */}
        <View style={st.transport}>
          <IconButton
            large
            name="undo"
            color={c.textPrimary}
            label={t.common.undo}
            disabled
            onPress={() => undefined}
          />
          {interrupted ? (
            <IconButton
              large
              name="play"
              color={c.textPrimary}
              label={t.record.resume}
              onPress={onToggleRec}
            />
          ) : (
            <IconButton
              large
              name={s === 'paused' ? 'play' : 'pause'}
              color={c.textPrimary}
              label={s === 'paused' ? t.record.resume : t.record.pause}
              disabled={!active}
              onPress={() => void (s === 'paused' ? ws.resumeRecording() : ws.pauseRecording())}
            />
          )}
          <Pressable
            onPress={interrupted ? onFinishInterrupted : onToggleRec}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={busy ? stateText(t, s) : t.record.stop}
            accessibilityState={{ disabled: busy, busy }}
            style={({ pressed }) => [
              st.rec,
              { backgroundColor: c.inverseSurface },
              pressed ? { transform: [{ scale: pressScale }] } : null,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={c.inverseText} />
            ) : (
              <View style={[st.recStop, { backgroundColor: c.recSolid }]} />
            )}
          </Pressable>
          <IconButton
            large
            name="nextTopic"
            color={c.textPrimary}
            label={next ? t.record.nextTopic(next.heading) : t.record.nextTopicShort}
            disabled={!next}
            onPress={advance}
          />
          <IconButton
            large
            name="list"
            color={c.textPrimary}
            label={t.record.topicsTitle}
            onPress={() => setTopics({ open: true, focus: current?.id ?? null })}
          />
        </View>
      </View>

      <TopicsSheet
        ws={ws}
        open={topics.open}
        focus={topics.focus}
        onClose={() => setTopics({ open: false, focus: null })}
      />
      <Sheet
        visible={assetsOpen}
        onClose={() => setAssetsOpen(false)}
        title={t.edit.insertTitle}
        subtitle={t.record.insertSubRecording}
      >
        {state.assets.map((a, i) => (
          <Row
            key={a.id}
            icon={a.is_favorite ? 'starFilled' : 'music'}
            label={a.name}
            sub={formatSmp(smp(a.duration_smp))}
            last={i === state.assets.length - 1}
            onPress={() => {
              setAssetsOpen(false);
              onInsertAsset(a);
            }}
          />
        ))}
      </Sheet>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  // 見本 `.np`: 上 4、左右 20、下 26、まとまりの間 16。
  np: { flex: 1, gap: space.lg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headText: { flex: 1, alignItems: 'center', gap: space.hair },
  body: { gap: space.lg },
  wave: { height: recordView.wave, borderRadius: radius.sm, overflow: 'hidden' },
  chap: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    top: space.x10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.x6,
  },
  levels: { gap: space.sm },
  clock: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  input: { flexDirection: 'row', alignItems: 'center', gap: space.x6, flexShrink: 1 },
  pads: { gap: space.sm },
  // 見本 `.pads button`: 上下 8・左右 12、丸い端、間 6。
  pad: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.x6,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    minHeight: hit.icon,
  },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // 見本 `.recbtn`: 白い丸 72 の中に、角丸 6 の赤い四角 26。
  rec: {
    width: hit.record,
    height: hit.record,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recStop: { width: recordView.stopMark, height: recordView.stopMark, borderRadius: radius.x6 },
});
