import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatSmp, secToSmp, smp, type Smp } from '@/domain/time';
import type { Range } from '@/domain/timeline/types';
import { useT } from '@/i18n';
import type { AssetRow } from '@/infra/db/repositories/assetsRepo';
import { useServices } from '@/features/app/ServicesProvider';
import { hit, icon, space, tabularNums, typography } from '@/ui/tokens';
import {
  Button,
  Field,
  Icon,
  IconButton,
  Row,
  Sheet,
  Text,
  Toggle,
  useCompact,
  type IconName,
} from '@/ui/components';
import { Display, DisplayCells, Key, keyLook, useKeyInk, type KeyTone } from '@/ui/device';
import { ask } from '@/ui/alerts';
import { useAppTheme } from '@/ui/ThemeContext';

import { parseSeconds, validateRange } from './selectionInput';
import { JogWheel } from './JogWheel';
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

const SAMPLE_RATE = 48000;
/** ジョグダイヤル 1 回転で動く秒数。 */
const SEC_PER_TURN = 10;
const toSec = (s: number) => (s / SAMPLE_RATE).toFixed(1);

/** 道具のキー。記号をキーに、名前をキーの下に置く。 */
function ToolKey({
  label,
  caption,
  icon: name,
  onPress,
  tone,
  busy,
}: {
  label: string;
  caption: string;
  icon: IconName;
  onPress: () => void;
  tone?: KeyTone;
  busy?: boolean;
}) {
  const ink = useKeyInk(tone ?? 'neutral');
  return (
    <View style={st.toolCell}>
      <Key
        label={label}
        caption={caption}
        onPress={onPress}
        tone={tone ?? 'neutral'}
        busy={!!busy}
        style={st.toolKey}
      >
        <Icon name={name} color={ink} size={icon.sm} />
      </Key>
    </View>
  );
}

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
  const [sheet, setSheet] = useState<null | 'overlay' | 'insert' | 'range'>(null);
  const jogBase = useRef(0);
  const { haptics } = useServices();
  const keyInk = (off: boolean) => keyLook(c, 'neutral', off).ink;
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
      <Display innerStyle={st.emptyInner}>
        <Text style={[typography.heading, { color: c.dispInk }]}>{t.edit.emptyTitle}</Text>
        <Text style={[typography.body, { color: c.dispDim }]}>{t.edit.emptySub}</Text>
      </Display>
    );
  }

  const cells = sel
    ? [
        {
          label: t.edit.cellStart,
          value: formatSmp(sel.start, { tenths: true }),
          onPress: () => setSheet('range'),
          a11yHint: t.edit.a11yEditRange,
        },
        {
          label: t.edit.cellEnd,
          value: formatSmp(sel.end, { tenths: true }),
          onPress: () => setSheet('range'),
          a11yHint: t.edit.a11yEditRange,
        },
        { label: t.edit.cellLength, value: t.edit.seconds(toSec(sel.end - sel.start)) },
      ]
    : [
        { label: t.edit.cellPosition, value: formatSmp(state.playhead) },
        { label: t.edit.cellTotal, value: formatSmp(state.total) },
        { label: t.edit.cellAssets, value: t.edit.count(state.doc.overlays.length) },
      ];

  return (
    <View style={st.root}>
      {/* 見るもの：再生位置・波形・選択の数値を 1 枚の表示窓に（PN-01、#115） */}
      <Display>
        <View style={st.clockRow}>
          <Text
            style={[
              compact ? typography.clockCompact : typography.clock,
              tabularNums,
              { color: c.dispInk },
            ]}
            accessibilityLabel={t.edit.a11yPlayhead(
              formatSmp(state.playhead),
              formatSmp(state.total),
            )}
          >
            {formatSmp(state.playhead)}
          </Text>
          <Text style={[typography.numeric, tabularNums, st.flex, { color: c.dispDim }]}>
            / {formatSmp(state.total)}
          </Text>
          <Text style={[typography.tick, tabularNums, { color: c.dispDim }]}>
            {`×${(pps / 24).toFixed(1)}`}
          </Text>
        </View>
        <View style={st.wave}>
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
        </View>
        <DisplayCells cells={cells} />
      </Display>

      {/* 触るもの：取り消し・ジョグ・拡大縮小 */}
      <View style={st.jogRow}>
        <View style={st.side}>
          <Key
            label={state.undoLabel ? t.edit.a11yUndo(state.undoLabel) : t.common.undo}
            caption={t.common.undo}
            disabled={!state.canUndo}
            onPress={() => void ws.undo().then((op) => op && onShowToast(t.undo.undid(op.label)))}
            style={st.sideKey}
          >
            <Icon name="undo" color={keyInk(!state.canUndo)} size={icon.sm} />
          </Key>
          <Key
            label={t.edit.zoomOut}
            onPress={() => setPps((p) => Math.max(4, p / 1.6))}
            style={st.zoomKey}
          >
            <Icon name="minus" color={keyInk(false)} size={icon.sm} />
          </Key>
        </View>
        <JogWheel
          label={t.edit.jog}
          hint={t.edit.a11yJogHint}
          onStart={() => {
            jogBase.current = state.playhead;
          }}
          onTurn={(deg) => {
            const to = jogBase.current + (deg / 360) * SEC_PER_TURN * SAMPLE_RATE;
            void ws.seek(smp(Math.max(0, Math.min(state.total, to))));
          }}
          onTick={() => haptics.play('selection')}
        />
        <View style={st.side}>
          <Key
            label={state.redoLabel ? t.edit.a11yRedo(state.redoLabel) : t.common.redo}
            caption={t.common.redo}
            disabled={!state.canRedo}
            onPress={() => void ws.redo().then((op) => op && onShowToast(t.undo.redid(op.label)))}
            style={st.sideKey}
          >
            <Icon name="redo" color={keyInk(!state.canRedo)} size={icon.sm} />
          </Key>
          <Key
            label={t.edit.zoomIn}
            onPress={() => setPps((p) => Math.min(200, p * 1.6))}
            style={st.zoomKey}
          >
            <Icon name="plus" color={keyInk(false)} size={icon.sm} />
          </Key>
        </View>
      </View>

      {/* 道具：選択があるときは選択への操作、無いときは全体への操作 */}
      {sel ? (
        <View style={st.tools}>
          <ToolKey
            label={t.edit.cutSelection}
            caption={t.edit.keyCut}
            icon="scissors"
            onPress={() => void doCut()}
          />
          <ToolKey
            label={t.edit.playSelection}
            caption={t.edit.keyPlay}
            icon="play"
            onPress={() => void playSelection()}
          />
          <ToolKey
            label={t.edit.punchIn}
            caption={t.edit.punchIn}
            icon="mic"
            onPress={() => {
              void ws
                .startRecording({ punchIn: sel })
                .then(() => onShowToast(t.edit.punchInStarted))
                .catch((e: unknown) => onError(String(e)));
            }}
          />
          <ToolKey
            label={t.edit.insertBefore}
            caption={t.edit.insertBefore}
            icon="music"
            onPress={() => {
              setInsertSide('before');
              setSheet('insert');
            }}
          />
          <ToolKey
            label={t.edit.insertAfter}
            caption={t.edit.insertAfter}
            icon="music"
            onPress={() => {
              setInsertSide('after');
              setSheet('insert');
            }}
          />
          <ToolKey
            label={t.edit.clearSelection}
            caption={t.edit.keyClear}
            icon="close"
            onPress={ws.clearSelection}
          />
        </View>
      ) : (
        <View style={st.tools}>
          <ToolKey
            label={t.edit.removeSilence}
            caption={t.edit.removeSilence}
            icon="scissors"
            busy={analyzing}
            onPress={() => void openSilence()}
          />
          <ToolKey
            label={t.edit.insert}
            caption={t.edit.insert}
            icon="plus"
            onPress={() => setSheet('insert')}
          />
          <ToolKey
            label={t.edit.toExport}
            caption={t.edit.toExport}
            icon="share"

            onPress={onGoExport}
          />
        </View>
      )}

      <Sheet
        visible={sheet === 'range' && !!sel}
        onClose={() => setSheet(null)}
        title={t.edit.rangeTitle}
      >
        <View style={st.fields}>
          <View style={st.flex}>
            <Field
              label={t.edit.startSec}
              value={f.start}
              keyboardType="decimal-pad"
              onChangeText={(v) => setFields({ ...f, start: v })}
              onEndEditing={commitFields}
              style={[typography.numeric, tabularNums]}
            />
          </View>
          <View style={st.flex}>
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
        <Button
          label={t.common.save}
          onPress={() => {
            commitFields();
            setSheet(null);
          }}
        />
      </Sheet>

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
  root: { gap: space.xl },
  flex: { flex: 1 },
  emptyInner: { padding: space.lg, gap: space.xs },
  clockRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingTop: space.md,
  },
  wave: { paddingTop: space.sm },
  jogRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  side: { width: hit.min + space.lg, alignItems: 'center', gap: space.md },
  sideKey: { width: hit.min + space.xs, height: hit.min + space.xs },
  zoomKey: { width: hit.min - space.xs, height: hit.min - space.sm },
  tools: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.lg, columnGap: space.md },
  toolCell: { flexBasis: '30%', flexGrow: 1 },
  toolKey: { width: '100%', height: hit.min + space.xs },
  fields: { flexDirection: 'row', gap: space.md },
  gainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gainValue: { minWidth: 72, textAlign: 'center' },
});
