import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatSmp, smp, type Smp } from '@/domain/time';
import type { Range } from '@/domain/timeline/types';
import { useT } from '@/i18n';
import type { AssetRow } from '@/infra/db/repositories/assetsRepo';
import { glyphSlop, icon, radius, space, tone, typography } from '@/ui/tokens';
import { Button, Chip, Row, Sheet, Toggle } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';

import { Waveform } from './Waveform';
import type { Workspace } from './useWorkspace';

export interface EditTabProps {
  ws: Workspace;
  onInsertAsset: (a: AssetRow) => void;
  onOpenAssets: () => void;
  onShowToast: (text: string, undo?: () => void) => void;
  onError: (message: string) => void;
}

/** 編集タブ（docs/ux-restructure.md §6）。 */
export function EditTab({ ws, onInsertAsset, onOpenAssets, onShowToast, onError }: EditTabProps) {
  const c = useAppTheme();
  const t = useT();
  const { state } = ws;
  const [pps, setPps] = useState(24);
  const [sheet, setSheet] = useState<null | 'overlay' | 'silence' | 'insert'>(null);
  const [silencePlan, setSilencePlan] = useState<{ ranges: Range[]; totalRemoved: Smp } | null>(
    null,
  );

  const selectedOverlay = state.doc.overlays.find((o) => o.id === state.selectedOverlay) ?? null;
  const selectedAsset = selectedOverlay
    ? state.assets.find((a) => a.id === selectedOverlay.assetId)
    : null;

  const openSilence = useCallback(async () => {
    setSheet('silence');
    setSilencePlan(null);
    try {
      setSilencePlan(await ws.planSilence());
    } catch (e) {
      onError(String(e));
      setSheet(null);
    }
  }, [onError, ws]);

  const doDelete = useCallback(async () => {
    const sel = state.selection;
    if (!sel) return;
    await ws.deleteSelection();
    onShowToast(
      t.edit.deleted(formatSmp(smp(sel.end - sel.start), { tenths: true })),
      () => void ws.undo(),
    );
  }, [onShowToast, state.selection, t, ws]);

  if (state.total === 0) {
    return (
      <View style={st.empty}>
        <Text style={[typography.body, { color: c.textSecondary }]}>{t.edit.emptyTitle}</Text>
        <Text style={[typography.caption, { color: c.textTertiary }]}>{t.edit.emptySub}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={st.clockRow}>
        <Text style={[typography.display, { color: c.textPrimary }]}>
          {formatSmp(state.playhead, { tenths: true })}
        </Text>
        <Text style={[typography.caption, { color: c.textSecondary }]}>
          / {formatSmp(state.total)}
        </Text>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => setPps((p) => Math.max(4, p / 1.6))}
          hitSlop={glyphSlop}
          accessibilityLabel={t.a11y.zoomOut}
        >
          <Text style={{ color: c.textSecondary, fontSize: icon.sm }}>－</Text>
        </Pressable>
        <Pressable
          onPress={() => setPps((p) => Math.min(200, p * 1.6))}
          hitSlop={glyphSlop}
          accessibilityLabel={t.a11y.zoomIn}
          style={{ marginLeft: space.md }}
        >
          <Text style={{ color: c.textSecondary, fontSize: icon.sm }}>＋</Text>
        </Pressable>
      </View>

      <Waveform
        voice={state.doc.voice}
        peaksByTake={state.peaksByTake}
        overlays={state.placedOverlays}
        chapters={ws.chaptersOnTimeline}
        events={ws.eventsOnTimeline}
        total={state.total}
        playhead={state.playhead}
        selection={state.selection}
        selectedOverlay={state.selectedOverlay}
        pps={pps}
        recording={false}
        recFrames={0}
        onSeek={(to) => void ws.seek(to)}
        onSelectOverlay={(oid) => {
          ws.selectOverlay(oid);
          if (oid) setSheet('overlay');
        }}
        onChapterPress={(item) => {
          const at = ws.chaptersOnTimeline.find((ch) => ch.item.id === item.id)?.at;
          if (at !== undefined) void ws.seek(at);
        }}
      />

      <View style={st.toolbar}>
        {state.selection ? (
          <>
            <Chip
              label={t.edit.delete}
              tone={tone(c, 'danger')}
              active
              onPress={() => void doDelete()}
            />
            <Chip
              label={t.edit.punchIn}
              onPress={() => {
                const sel = state.selection;
                if (!sel) return;
                void ws
                  .startRecording({ punchIn: sel })
                  .then(() => onShowToast(t.edit.punchInStarted))
                  .catch((e: unknown) => onError(String(e)));
              }}
            />
            <Chip label={t.edit.insertBefore} onPress={() => setSheet('insert')} />
            <Chip label={t.edit.clearSelection} onPress={ws.clearSelection} />
          </>
        ) : (
          <>
            <Chip label={t.edit.selectRange} onPress={ws.setSelectionStart} />
            <Chip label={t.edit.selectionEnd} onPress={ws.setSelectionEnd} />
            <Chip label={t.edit.removeSilence} onPress={() => void openSilence()} />
            <Chip label={t.edit.insert} onPress={() => setSheet('insert')} />
          </>
        )}
      </View>
      <Text style={[typography.caption, { color: c.textTertiary, paddingBottom: space.sm }]}>
        {state.selection
          ? t.edit.hintSelection(formatSmp(state.selection.start), formatSmp(state.selection.end))
          : t.edit.hintIdle}
      </Text>

      <Sheet
        visible={sheet === 'silence'}
        onClose={() => setSheet(null)}
        title={t.edit.silenceTitle}
        subtitle={t.edit.silenceSubtitle}
      >
        {!silencePlan ? (
          <Text style={{ color: c.textSecondary }}>{t.edit.silenceAnalyzing}</Text>
        ) : silencePlan.ranges.length === 0 ? (
          <Text style={{ color: c.textSecondary }}>{t.edit.silenceNone}</Text>
        ) : (
          <>
            <Text style={{ color: c.textPrimary, marginBottom: space.md }}>
              {t.edit.silencePlan(
                silencePlan.ranges.length,
                formatSmp(silencePlan.totalRemoved, { tenths: true }),
              )}
            </Text>
            <Button
              label={t.edit.silenceApply}
              onPress={() => {
                const ranges = silencePlan.ranges;
                setSheet(null);
                void ws
                  .applySilencePlan(ranges)
                  .then(() =>
                    onShowToast(t.edit.silenceApplied(ranges.length), () => void ws.undo()),
                  );
              }}
            />
          </>
        )}
      </Sheet>

      <Sheet
        visible={sheet === 'insert'}
        onClose={() => setSheet(null)}
        title={t.edit.insertTitle}
        subtitle={t.edit.insertSubtitle(formatSmp(state.playhead))}
      >
        {state.assets.length === 0 ? (
          <Row label={t.record.registerAssets} onPress={onOpenAssets} />
        ) : null}
        {state.assets.map((a) => (
          <Row
            key={a.id}
            label={`${a.is_favorite ? '★ ' : ''}${a.name}`}
            sub={formatSmp(smp(a.duration_smp))}
            onPress={() => {
              setSheet(null);
              onInsertAsset(a);
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
        subtitle={selectedOverlay ? `${selectedOverlay.gainDb.toFixed(1)} dB` : ''}
      >
        {selectedOverlay ? (
          <>
            <View style={st.gainRow}>
              <Text style={{ color: c.textPrimary }}>{t.edit.gain}</Text>
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={() =>
                  void ws.updateOverlay(
                    selectedOverlay.id,
                    t.undo.changeGain,
                    (o) => ({ ...o, gainDb: Math.max(-40, o.gainDb - 1) }),
                    `gain:${selectedOverlay.id}`,
                  )
                }
                hitSlop={glyphSlop}
                style={st.pm}
                accessibilityLabel={t.a11y.decrease(t.edit.gain)}
              >
                <Text style={{ color: c.textPrimary, fontSize: icon.sm }}>－</Text>
              </Pressable>
              <Text style={{ color: c.textPrimary, width: 72, textAlign: 'center' }}>
                {selectedOverlay.gainDb.toFixed(1)} dB
              </Text>
              <Pressable
                onPress={() =>
                  void ws.updateOverlay(
                    selectedOverlay.id,
                    t.undo.changeGain,
                    (o) => ({ ...o, gainDb: Math.min(12, o.gainDb + 1) }),
                    `gain:${selectedOverlay.id}`,
                  )
                }
                hitSlop={glyphSlop}
                style={st.pm}
                accessibilityLabel={t.a11y.increase(t.edit.gain)}
              >
                <Text style={{ color: c.textPrimary, fontSize: icon.sm }}>＋</Text>
              </Pressable>
            </View>
            {selectedOverlay.kind === 'bgm' ? (
              <Row
                label={t.edit.duck}
                sub={t.edit.duckSub}
                right={
                  <Toggle
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
              label={t.edit.removeOverlay}
              danger
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
  empty: { paddingVertical: space.xxxl, gap: space.xs },
  clockRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
    paddingVertical: space.xs,
  },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingVertical: space.sm },
  gainRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, gap: space.sm },
  pm: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  radius: { borderRadius: radius.md },
});
