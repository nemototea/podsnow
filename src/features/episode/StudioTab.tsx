import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatClock, formatSmp, secToSmp, smp, type Smp } from '@/domain/time';
import type { Range } from '@/domain/timeline/types';
import { useT, type Messages } from '@/i18n';
import type { AssetRow } from '@/infra/db/repositories/assetsRepo';
import type { SessionState } from '@/services/recording/RecordingSession';
import { icon, radius, space, tabularNums, typography } from '@/ui/tokens';
import {
  Button,
  Card,
  Chip,
  Field,
  Icon,
  IconButton,
  Notice,
  Row,
  SectionHeader,
  Sheet,
  Text,
  Toggle,
  useCompact,
  type IconName,
} from '@/ui/components';
import { ask, confirmDestructive } from '@/ui/alerts';
import { useAppTheme } from '@/ui/ThemeContext';

import { LevelMeter } from './LevelMeter';
import { parseSeconds, validateRange } from './selectionInput';
import { TopicsSection } from './TopicsSection';
import { Waveform } from './Waveform';
import type { RecordingContext } from './useRecordingContext';
import type { Workspace } from './useWorkspace';

export interface StudioTabProps {
  ws: Workspace;
  recCtx: RecordingContext;
  /** `at` を省くと、録音中は発言位置、待機中は再生位置に入る。 */
  onInsertAsset: (a: AssetRow, at?: Smp) => void;
  onOpenAssets: () => void;
  onShowToast: (text: string, undo?: () => void) => void;
  onError: (message: string) => void;
  onGoExport: () => void;
}

const toSec = (s: number) => (s / 48000).toFixed(1);
const noop = () => {};

/** 待機中は何も出さない。録音ボタン・タイマー・メーターで分かる（DESIGN_SYSTEM.md §2.3）。 */
function stateLabel(t: Messages, s: SessionState): { text: string; icon: IconName | null } | null {
  switch (s) {
    case 'recording':
      return { text: t.record.stateRecording, icon: 'record' };
    case 'paused':
      return { text: t.record.statePaused, icon: 'pause' };
    case 'interrupted':
      return { text: t.record.stateInterrupted, icon: 'warning' };
    case 'preparing':
      return { text: t.record.statePreparing, icon: null };
    case 'stopping':
      return { text: t.record.stateStopping, icon: null };
    default:
      return null;
  }
}

/**
 * 収録タブ（Issue #122）。録音と編集を 1 つの画面で行う。
 * 上に波形、下に再生と録音（Transport）。録音は再生位置から始まり、途中なら差し込む。
 * 録音中は波形に触れず、レベル・入力・話すこと・素材ボタンを出す。
 * 待機中は塊の選択と削除・無音を詰める・素材を足す操作を出す。
 */
export function StudioTab({
  ws,
  recCtx,
  onInsertAsset,
  onOpenAssets,
  onShowToast,
  onError,
  onGoExport,
}: StudioTabProps) {
  const c = useAppTheme();
  const t = useT();
  const compact = useCompact();
  const { state } = ws;
  const s = state.recording;
  const live = s !== 'idle';
  // 素材は、割り込みで止まっている間も録音中のテイクの位置に入る
  const isRec = s === 'recording' || s === 'paused' || s === 'interrupted';
  const label = stateLabel(t, s);
  const stateColor =
    s === 'recording' ? c.recText : s === 'interrupted' ? c.mistakeText : c.textSecondary;
  const favorites = state.assets.filter(
    (a) => a.is_favorite && (a.kind === 'jingle' || a.kind === 'sfx'),
  );
  const inputName = recCtx.inputKnown
    ? (recCtx.input?.name ?? t.record.builtInMic)
    : t.record.inputUnknown;
  const channels = recCtx.channels === 2 ? t.settings.stereo : t.settings.mono;
  const [pps, setPps] = useState(24);
  const [sheet, setSheet] = useState<null | 'overlay' | 'insert'>(null);
  const [insertSide, setInsertSide] = useState<'before' | 'after'>('after');
  const [analyzing, setAnalyzing] = useState(false);
  const [fields, setFields] = useState<{ key: string; start: string; end: string } | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);

  const sel = live ? null : state.selection;
  const selKey = sel ? `${sel.start}-${sel.end}` : '';
  const f =
    fields && fields.key === selKey
      ? fields
      : { key: selKey, start: sel ? toSec(sel.start) : '', end: sel ? toSec(sel.end) : '' };

  const insertPosition = sel ? (insertSide === 'before' ? sel.start : sel.end) : state.playhead;
  const selectedOverlay = state.doc.overlays.find((o) => o.id === state.selectedOverlay) ?? null;
  const selectedAsset = selectedOverlay
    ? state.assets.find((a) => a.id === selectedOverlay.assetId)
    : null;

  const applySilence = useCallback(
    (ranges: Range[]) =>
      void ws
        .applySilencePlan(ranges)
        .then(() => onShowToast(t.edit.silenceApplied(ranges.length), () => void ws.undo())),
    [onShowToast, t, ws],
  );

  /** 調べた結果をアラートで確かめてから詰める（DESIGN_SYSTEM.md §6.2）。 */
  const openSilence = useCallback(async () => {
    setAnalyzing(true);
    try {
      const plan = await ws.planSilence();
      if (plan.ranges.length === 0) {
        onShowToast(t.edit.silenceNone);
        return;
      }
      ask({
        title: t.edit.silenceTitle,
        message: `${t.edit.silencePlan(
          plan.ranges.length,
          formatSmp(plan.totalRemoved, { tenths: true }),
        )}\n${t.edit.silenceSubtitle}`,
        confirmLabel: t.edit.silenceApply,
        cancelLabel: t.common.cancel,
        onConfirm: () => applySilence(plan.ranges),
      });
    } catch (e) {
      onError(String(e));
    } finally {
      setAnalyzing(false);
    }
  }, [applySilence, onError, onShowToast, t, ws]);

  const doCut = useCallback(() => {
    if (!sel) return;
    const length = formatSmp(smp(sel.end - sel.start), { tenths: true });
    confirmDestructive({
      title: t.edit.confirmDelete(length),
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      onConfirm: () =>
        void ws
          .deleteSelection()
          .then(() => onShowToast(t.edit.deleted(length), () => void ws.undo())),
    });
  }, [onShowToast, sel, t, ws]);

  const commitFields = () => {
    const start = parseSeconds(f.start);
    const end = parseSeconds(f.end);
    const totalSec = state.total / 48000;
    const err = validateRange(start, end, totalSec);
    if (err) {
      setRangeError(t.edit.rangeError(totalSec.toFixed(1)));
      return;
    }
    setRangeError(null);
    ws.setSelection({ start: secToSmp(start!), end: secToSmp(end!) });
  };

  const playSelection = async () => {
    if (!sel) return;
    await ws.seek(sel.start);
    if (!state.playing) await ws.togglePlay();
  };

  return (
    <View>
      {/* 待機中も行の高さは取っておく。録音を始めた瞬間に下がずれないように。 */}
      <View style={st.statusRow}>
        <View style={st.stateLabel} accessibilityLiveRegion="polite">
          {label?.icon ? <Icon name={label.icon} color={stateColor} size={icon.sm} /> : null}
          {label ? (
            <Text style={[typography.label, { color: stateColor }]}>{label.text}</Text>
          ) : null}
        </View>
        {live ? (
          <Text style={[typography.caption, { color: c.textSecondary }]}>
            {t.record.takeLabel(state.takes.length + 1)}
          </Text>
        ) : null}
      </View>

      {live ? (
        <Text
          style={[
            compact ? typography.timerCompact : typography.timer,
            tabularNums,
            { color: c.textPrimary },
          ]}
          accessibilityLabel={t.record.a11yElapsed(formatClock(smp(state.recFrames)))}
        >
          {formatClock(smp(state.recFrames))}
        </Text>
      ) : (
        <View style={st.clock}>
          <Text
            style={[
              compact ? typography.clockCompact : typography.clock,
              tabularNums,
              { color: c.textPrimary },
            ]}
            accessibilityLabel={t.edit.a11yPlayhead(
              formatSmp(state.playhead),
              formatSmp(state.total),
            )}
          >
            {formatSmp(state.playhead)}
          </Text>
          <Text style={[typography.numeric, tabularNums, { color: c.textSecondary }]}>
            / {formatSmp(state.total)}
          </Text>
        </View>
      )}

      <View style={[st.panel, { backgroundColor: c.surface }]}>
        <Waveform
          voice={state.doc.voice}
          peaksByTake={state.peaksByTake}
          overlays={state.placedOverlays}
          assetNames={state.assets}
          chapters={ws.chaptersOnTimeline}
          events={ws.eventsOnTimeline}
          total={state.total}
          playhead={state.playhead}
          selection={sel}
          selectedOverlay={live ? null : state.selectedOverlay}
          pps={pps}
          recording={live}
          recFrames={state.recFrames}
          recordAt={state.recAt}
          blocks={ws.blocks}
          // 録音中・一時停止中は位置を動かせない。位置を変えるときは止める（Issue #122）
          {...(live
            ? {
                onSeek: noop,
                onSelectOverlay: noop,
                onChapterPress: noop,
              }
            : {
                onSelectBlock: (at: Smp) => {
                  const b = ws.selectBlockAt(at);
                  void ws.seek(b ? b.start : at);
                },
                onSelectionChange: (range: Range) => ws.setSelection(range),
                onSeek: (to: Smp) => void ws.seek(to),
                onSelectOverlay: (oid: string | null) => {
                  ws.selectOverlay(oid);
                  if (oid) setSheet('overlay');
                },
                onChapterPress: (item: { id: string }) => {
                  const at = ws.chaptersOnTimeline.find((ch) => ch.item.id === item.id)?.at;
                  if (at !== undefined) void ws.seek(at);
                },
                onChapterLongPress: (item: { id: string }) => {
                  const range = ws.chapterRange(item.id);
                  if (range) ws.setSelection(range);
                },
              })}
        />
        <View style={st.zoom}>
          <IconButton
            name="minus"
            label={t.a11y.zoomOut}
            onPress={() => setPps((p) => Math.max(4, p / 1.6))}
          />
          <IconButton
            name="plus"
            label={t.a11y.zoomIn}
            onPress={() => setPps((p) => Math.min(200, p * 1.6))}
          />
        </View>
      </View>

      {live ? (
        <LevelMeter level={s === 'recording' ? state.level : null} />
      ) : state.total === 0 ? (
        <Card style={st.empty}>
          <Text style={[typography.heading, { color: c.textPrimary }]}>{t.edit.emptyTitle}</Text>
          <Text style={[typography.body, { color: c.textSecondary, marginTop: space.xs }]}>
            {t.edit.emptySub}
          </Text>
        </Card>
      ) : null}

      <View style={st.inputRow}>
        <Icon
          name={recCtx.input?.type === 'builtin' ? 'mic' : 'headphones'}
          color={c.textSecondary}
          size={icon.sm}
        />
        <Text style={[typography.caption, { color: c.textSecondary, flex: 1 }]}>
          {t.record.inputLine(inputName, channels)}
        </Text>
      </View>
      {recCtx.input?.lowQuality ? (
        <Notice kind="warning" title={t.record.bluetoothTitle} body={t.settings.bluetoothWarning} />
      ) : null}

      {sel ? (
        <Text
          style={[typography.caption, tabularNums, { color: c.textSecondary, marginTop: space.sm }]}
        >
          {t.edit.hintSelection(formatSmp(sel.start), formatSmp(sel.end, { tenths: true }))}
        </Text>
      ) : null}

      {sel ? (
        <>
          <View style={st.fields}>
            <View style={st.field}>
              <Field
                label={t.edit.startSec}
                value={f.start}
                keyboardType="decimal-pad"
                onChangeText={(v) => setFields({ ...f, start: v })}
                onEndEditing={commitFields}
                style={[typography.numeric, tabularNums]}
              />
            </View>
            <View style={st.field}>
              <Field
                label={t.edit.endSec}
                value={f.end}
                keyboardType="decimal-pad"
                onChangeText={(v) => setFields({ ...f, end: v })}
                onEndEditing={commitFields}
                error={rangeError}
                style={[typography.numeric, tabularNums]}
              />
            </View>
          </View>
          <View style={st.grid}>
            <Button
              label={t.edit.cutSelection}
              kind="secondary"
              icon="scissors"
              style={st.cell}
              onPress={doCut}
            />
            <Button
              label={t.edit.playSelection}
              kind="secondary"
              icon="play"
              style={st.cell}
              onPress={() => void playSelection()}
            />
            <Button
              label={t.edit.insertBefore}
              kind="secondary"
              icon="music"
              style={st.cell}
              onPress={() => {
                setInsertSide('before');
                setSheet('insert');
              }}
            />
            <Button
              label={t.edit.insertAfter}
              kind="secondary"
              icon="music"
              style={st.cell}
              onPress={() => {
                setInsertSide('after');
                setSheet('insert');
              }}
            />
            <Button
              label={t.edit.clearSelection}
              kind="ghost"
              style={st.cell}
              onPress={ws.clearSelection}
            />
          </View>
        </>
      ) : live || state.total === 0 ? null : (
        <View style={st.grid}>
          <Button
            label={t.edit.removeSilence}
            kind="secondary"
            style={st.cell}
            busy={analyzing}
            onPress={() => void openSilence()}
          />
          <Button
            label={t.edit.insert}
            kind="secondary"
            icon="plus"
            style={st.cell}
            onPress={() => setSheet('insert')}
          />
        </View>
      )}

      <TopicsSection ws={ws} onShowToast={(text) => onShowToast(text)} />

      <SectionHeader title={t.record.assetsTitle} />
      {favorites.length === 0 ? (
        <Button
          label={t.record.registerAssets}
          icon="plus"
          kind="secondary"
          onPress={onOpenAssets}
        />
      ) : (
        <View style={st.assets}>
          {favorites.slice(0, 4).map((a) => (
            <Chip
              key={a.id}
              icon="music"
              label={a.name}
              accessibilityLabel={
                isRec ? t.record.a11yInsertNow(a.name) : t.record.a11yInsertAt(a.name)
              }
              onPress={() => onInsertAsset(a)}
            />
          ))}
          <Chip label={t.record.moreAssets} onPress={() => setSheet('insert')} />
        </View>
      )}

      {live || state.total === 0 ? null : (
        <Button label={t.edit.toExport} style={st.next} onPress={onGoExport} />
      )}

      <Sheet
        visible={sheet === 'insert'}
        onClose={() => setSheet(null)}
        title={t.edit.insertTitle}
        subtitle={
          isRec ? t.record.insertSubRecording : t.edit.insertSubtitle(formatSmp(insertPosition))
        }
      >
        {state.assets.length === 0 ? (
          <Row label={t.record.registerAssets} onPress={onOpenAssets} last />
        ) : null}
        {state.assets.map((a, i) => (
          <Row
            key={a.id}
            icon={a.is_favorite ? 'starFilled' : 'music'}
            label={a.name}
            sub={formatSmp(smp(a.duration_smp))}
            last={i === state.assets.length - 1}
            onPress={() => {
              setSheet(null);
              if (isRec) onInsertAsset(a);
              else onInsertAsset(a, insertPosition);
            }}
          />
        ))}
      </Sheet>

      <Sheet
        visible={sheet === 'overlay' && !!selectedOverlay}
        onClose={() => {
          setSheet(null);
          ws.selectOverlay(null);
        }}
        title={selectedAsset?.name ?? t.edit.overlayFallback}
      >
        {selectedOverlay ? (
          <>
            <View style={[st.gainRow, { borderBottomColor: c.border }]}>
              <Text style={[typography.body, { color: c.textPrimary, flex: 1 }]}>
                {t.edit.gain}
              </Text>
              <IconButton
                name="minus"
                label={t.a11y.decrease(t.edit.gain)}
                onPress={() =>
                  void ws.updateOverlay(
                    selectedOverlay.id,
                    t.undo.changeGain,
                    (o) => ({ ...o, gainDb: Math.max(-40, o.gainDb - 1) }),
                    `gain:${selectedOverlay.id}`,
                  )
                }
              />
              <Text
                style={[typography.numeric, tabularNums, st.gainValue, { color: c.textPrimary }]}
              >
                {selectedOverlay.gainDb.toFixed(1)} dB
              </Text>
              <IconButton
                name="plus"
                label={t.a11y.increase(t.edit.gain)}
                onPress={() =>
                  void ws.updateOverlay(
                    selectedOverlay.id,
                    t.undo.changeGain,
                    (o) => ({ ...o, gainDb: Math.min(12, o.gainDb + 1) }),
                    `gain:${selectedOverlay.id}`,
                  )
                }
              />
            </View>
            {selectedOverlay.kind === 'bgm' ? (
              <Row
                label={t.edit.duck}
                sub={t.edit.duckSub}
                right={
                  <Toggle
                    accessibilityLabel={t.edit.duck}
                    value={selectedOverlay.duck}
                    onChange={(v) =>
                      void ws.updateOverlay(selectedOverlay.id, t.undo.changeDucking, (o) => ({
                        ...o,
                        duck: v,
                      }))
                    }
                  />
                }
              />
            ) : null}
            <Row
              label={t.edit.fadeIn}
              right={
                <Toggle
                  accessibilityLabel={t.edit.fadeIn}
                  value={selectedOverlay.fadeIn > 0}
                  onChange={(v) =>
                    void ws.updateOverlay(selectedOverlay.id, t.undo.changeFade, (o) => ({
                      ...o,
                      fadeIn: smp(v ? 96000 : 0),
                    }))
                  }
                />
              }
            />
            <Row
              label={t.edit.fadeOut}
              right={
                <Toggle
                  accessibilityLabel={t.edit.fadeOut}
                  value={selectedOverlay.fadeOut > 0}
                  onChange={(v) =>
                    void ws.updateOverlay(selectedOverlay.id, t.undo.changeFade, (o) => ({
                      ...o,
                      fadeOut: smp(v ? 96000 : 0),
                    }))
                  }
                />
              }
            />
            {selectedOverlay.kind !== 'opening' && selectedOverlay.kind !== 'ending' ? (
              <Row
                label={t.edit.moveHere}
                sub={t.edit.moveHereSub(formatSmp(state.playhead))}
                onPress={() => {
                  void ws.moveOverlayTo(selectedOverlay.id, state.playhead);
                  setSheet(null);
                }}
              />
            ) : null}
            <Row
              icon="trash"
              label={t.edit.removeOverlay}
              danger
              last
              onPress={() =>
                confirmDestructive({
                  title: t.edit.confirmRemoveOverlay,
                  confirmLabel: t.edit.removeOverlayShort,
                  cancelLabel: t.common.cancel,
                  onConfirm: () => {
                    setSheet(null);
                    void ws
                      .removeOverlay(selectedOverlay.id)
                      .then(() => onShowToast(t.edit.overlayRemoved, () => void ws.undo()));
                  },
                })
              }
            />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

const st = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    minHeight: typography.label.lineHeight,
  },
  stateLabel: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  clock: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexShrink: 1 },
  empty: { marginTop: space.md },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  assets: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  panel: { borderRadius: radius.lg, paddingTop: space.md, marginTop: space.sm, overflow: 'hidden' },
  zoom: { flexDirection: 'row', justifyContent: 'flex-end' },
  fields: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  field: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  cell: { flexGrow: 1, flexBasis: '45%' },
  next: { marginTop: space.xl },
  gainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gainValue: { minWidth: 72, textAlign: 'center' },
});
