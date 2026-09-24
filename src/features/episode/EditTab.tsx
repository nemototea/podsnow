import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatSmp, secToSmp, smp, type Smp } from '@/domain/time';
import type { Range } from '@/domain/timeline/types';
import { useT } from '@/i18n';
import type { AssetRow } from '@/infra/db/repositories/assetsRepo';
import { radius, space, tabularNums, typography } from '@/ui/tokens';
import {
  Button,
  Card,
  Field,
  IconButton,
  Row,
  Sheet,
  Text,
  Toggle,
  useCompact,
} from '@/ui/components';
import { ask } from '@/ui/alerts';
import { useAppTheme } from '@/ui/ThemeContext';

import { parseSeconds, validateRange } from './selectionInput';
import { Waveform } from './Waveform';
import type { Workspace } from './useWorkspace';

export interface EditTabProps {
  ws: Workspace;
  onInsertAsset: (a: AssetRow, at?: Smp) => void;
  onOpenAssets: () => void;
  onShowToast: (text: string, undo?: () => void) => void;
  onError: (message: string) => void;
  onGoExport: () => void;
}

const toSec = (s: number) => (s / 48000).toFixed(1);

export function EditTab({
  ws,
  onInsertAsset,
  onOpenAssets,
  onShowToast,
  onError,
  onGoExport,
}: EditTabProps) {
  const c = useAppTheme();
  const t = useT();
  const compact = useCompact();
  const { state } = ws;
  const [pps, setPps] = useState(24);
  const [sheet, setSheet] = useState<null | 'overlay' | 'insert'>(null);
  const [insertSide, setInsertSide] = useState<'before' | 'after'>('after');
  const [analyzing, setAnalyzing] = useState(false);
  const [fields, setFields] = useState<{ key: string; start: string; end: string } | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);

  const sel = state.selection;
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

  const doCut = useCallback(async () => {
    if (!sel) return;
    await ws.deleteSelection();
    onShowToast(
      t.edit.deleted(formatSmp(smp(sel.end - sel.start), { tenths: true })),
      () => void ws.undo(),
    );
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

  if (state.total === 0) {
    return (
      <Card>
        <Text style={[typography.heading, { color: c.textPrimary }]}>{t.edit.emptyTitle}</Text>
        <Text style={[typography.body, { color: c.textSecondary, marginTop: space.xs }]}>
          {t.edit.emptySub}
        </Text>
      </Card>
    );
  }

  return (
    <View>
      <View style={st.clockRow}>
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
        <View style={st.tools}>
          <IconButton
            name="undo"
            label={state.undoLabel ? t.edit.a11yUndo(state.undoLabel) : t.common.undo}
            disabled={!state.canUndo}
            onPress={() => void ws.undo().then((op) => op && onShowToast(t.undo.undid(op.label)))}
          />
          <IconButton
            name="redo"
            label={state.redoLabel ? t.edit.a11yRedo(state.redoLabel) : t.common.redo}
            disabled={!state.canRedo}
            onPress={() => void ws.redo().then((op) => op && onShowToast(t.undo.redid(op.label)))}
          />
        </View>
      </View>

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
          selectedOverlay={state.selectedOverlay}
          pps={pps}
          recording={false}
          recFrames={0}
          blocks={ws.blocks}
          onSelectBlock={(at) => {
            const b = ws.selectBlockAt(at);
            void ws.seek(b ? b.start : at);
          }}
          onSelectionChange={(range) => ws.setSelection(range)}
          onSeek={(to) => void ws.seek(to)}
          onSelectOverlay={(oid) => {
            ws.selectOverlay(oid);
            if (oid) setSheet('overlay');
          }}
          onChapterPress={(item) => {
            const at = ws.chaptersOnTimeline.find((ch) => ch.item.id === item.id)?.at;
            if (at !== undefined) void ws.seek(at);
          }}
          onChapterLongPress={(item) => {
            const range = ws.chapterRange(item.id);
            if (range) ws.setSelection(range);
          }}
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

      {sel ? (
        <Text style={[typography.caption, { color: c.textSecondary, marginTop: space.sm }]}>
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
              onPress={() => void doCut()}
            />
            <Button
              label={t.edit.playSelection}
              kind="secondary"
              icon="play"
              style={st.cell}
              onPress={() => void playSelection()}
            />
            <Button
              label={t.edit.punchIn}
              kind="secondary"
              icon="mic"
              style={st.cell}
              onPress={() => {
                void ws
                  .startRecording({ punchIn: sel })
                  .then(() => onShowToast(t.edit.punchInStarted))
                  .catch((e: unknown) => onError(String(e)));
              }}
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
      ) : (
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

      <Button label={t.edit.toExport} style={st.next} onPress={onGoExport} />

      <Sheet
        visible={sheet === 'insert'}
        onClose={() => setSheet(null)}
        title={t.edit.insertTitle}
        subtitle={t.edit.insertSubtitle(formatSmp(insertPosition))}
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
              onInsertAsset(a, insertPosition);
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
              icon="close"
              label={t.edit.removeOverlay}
              last
              onPress={() => {
                void ws.removeOverlay(selectedOverlay.id);
                setSheet(null);
                onShowToast(t.edit.overlayRemoved, () => void ws.undo());
              }}
            />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

const st = StyleSheet.create({
  clockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clock: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexShrink: 1 },
  tools: { flexDirection: 'row', marginRight: -space.md },
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
