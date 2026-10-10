import { useEffect, useMemo, useState } from 'react';
import {
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
import { NotesCard } from '@/ui/NotesCard';
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

import { liveColumns, type LivePeak } from './livePeaks';
import { describeInput } from './describeInput';
import { storageLine } from './storageLine';
import type { RecordingContext } from './useRecordingContext';
import type { Workspace } from './useWorkspace';

/** 番組の色の上の白の濃さ（見本 `.np .head small` 75%、`.np .title span` / `.clock span` 72%）。 */
const HEAD_ALPHA = 0.75;
const SUB_ALPHA = 0.72;
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
 * 上から 閉じる・状態・番組名 → ライブ波形 → 題 → 時間とレベル → カンペ → ジングル → 操作バー（見本の並び。Issue #179 C1）。
 * 題の下は差し込み位置の補足だけ（テイクの番号は出さない。Issue #179 C3）。
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
  const [assetsOpen, setAssetsOpen] = useState(false);
  // カンペのカードの高さ = 見えている高さから、カードより上の中身とジングルの列を引いた残り（見本 `.cue` の flex: 1）。
  // 中身の ScrollView の中では flex で伸ばせない（高さが決まらず、カードが本文の長さまで伸びて画面ごと流れる）ので測る。
  // 足りなければ最低の高さにし、そのときだけ画面全体がスクロールする。
  const [viewH, setViewH] = useState(0);
  const [cardTop, setCardTop] = useState(0);
  const [padsH, setPadsH] = useState(0);
  const notesH = viewH
    ? Math.max(
        recordView.notesMin,
        viewH - cardTop - (state.assets.length && padsH ? padsH + space.lg : 0),
      )
    : recordView.notesMin;

  const top = colors.nowPlaying;
  const head = compositeHex(c.textPrimary, HEAD_ALPHA, top);
  const sub = compositeHex(c.textPrimary, SUB_ALPHA, top);
  const panel = compositeHex(c.inverseText, PANEL_ALPHA, top);
  const padBg = compositeHex(c.textPrimary, PAD_ALPHA, colors.nowPlayingMid);

  const favorites = state.assets.filter(
    (a) => a.is_favorite && (a.kind === 'jingle' || a.kind === 'sfx'),
  );
  const input = describeInput(t, recCtx.input);
  const inputName = recCtx.inputKnown ? input.name : t.record.inputUnknown;
  const storage = storageLine(t, recCtx, active);
  const db =
    s === 'recording' && state.level && Number.isFinite(state.level.peakDb)
      ? Math.round(state.level.peakDb)
      : null;
  const clock = formatClock(smp(state.recFrames));
  const where =
    state.recAt === null
      ? t.record.appendAtEnd
      : t.record.insertAtPosition(formatSmp(ws.toOutput(state.recAt)));

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
          {/* 録音中は操作を出さず、閉じると同じく理由を伝える（見本では白の「…」） */}
          <IconButton
            name="more"
            color={c.textPrimary}
            label={t.record.a11yMenuLocked}
            onPress={onLockedBack}
          />
        </View>

        <ScrollView
          style={st.flex}
          contentContainerStyle={st.body}
          onLayout={(e) => setViewH(e.nativeEvent.layout.height)}
          showsVerticalScrollIndicator={false}
        >
          {/* 見本 `.wavebox` */}
          <View style={[st.wave, { backgroundColor: panel }]}>
            <LiveWave peaks={livePeaks} panel={panel} />
            {s === 'recording' ? (
              <View style={st.tag}>
                <Pill label={t.record.recPill} kind="rec" />
              </View>
            ) : null}
          </View>

          {/* 見本 `.np .title` */}
          <View>
            <Text style={[typography.nowPlaying, { color: c.textPrimary }]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[typography.subtitle, { color: sub }]} numberOfLines={1}>
              {where}
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
                <Icon name={input.icon} color={sub} size={icon.inline} />
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
            {/* 残りが 1 時間以上なら出さない。保存停止・確認できないときは常に出す（Issue #179） */}
            {storage ? (
              <Text
                style={[
                  typography.small,
                  { color: active && !recCtx.writerOk ? c.textPrimary : sub },
                ]}
              >
                {storage}
              </Text>
            ) : null}
          </View>

          {/* 見本 `.cue`（DESIGN_SYSTEM.md §2.7）。読むだけ。空なら出さない */}
          {state.notes.trim() ? (
            <View style={{ height: notesH }} onLayout={(e) => setCardTop(e.nativeEvent.layout.y)}>
              <NotesCard color={colors.notesCard} heading={t.notes.title} body={state.notes} />
            </View>
          ) : null}

          {/* 見本 `.pads` */}
          {state.assets.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={st.pads}
              onLayout={(e) => setPadsH(e.nativeEvent.layout.height)}
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

        {/* 見本 `.transport`: 左に一時停止、中央に録音の丸、右は空ける（3 列を等しく分け、丸を中央に固定） */}
        <View style={st.transport}>
          <View style={st.side}>
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
          </View>
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
          <View style={st.side} />
        </View>
      </View>

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
  // 見本 `.wavebox .tag`: 左上 12・10 に録音中の札。
  tag: { position: 'absolute', left: space.md, top: space.x10, flexDirection: 'row' },
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
  transport: { flexDirection: 'row', alignItems: 'center' },
  side: { flex: 1, alignItems: 'center' },
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
