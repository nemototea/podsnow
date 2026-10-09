import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatSmp, secToSmp, smp, type Smp } from '@/domain/time';
import type { Range } from '@/domain/timeline/types';
import { useT } from '@/i18n';
import type { AssetRow } from '@/infra/db/repositories/assetsRepo';
import {
  Button,
  Card,
  Chip,
  Field,
  IconButton,
  Notice,
  Row,
  Screen,
  Text,
  Toggle,
} from '@/ui/components';
import { Sheet } from '@/ui/Sheet';
import { useAppTheme } from '@/ui/ThemeContext';
import { grabber, icon, radius, space, stroke, tabularNums, typography } from '@/ui/tokens';

import { parseSeconds, validateRange } from './selectionInput';
import { storageLine } from './storageLine';
import { NotesSheet } from './NotesSheet';
import type { RecordingContext } from './useRecordingContext';
import type { Workspace } from './useWorkspace';
import { Waveform } from './Waveform';

export interface StudioTabProps {
  ws: Workspace;
  recCtx: RecordingContext;
  /** 画面の上部（戻る・題・取り消し）と「収録 / 書き出し」のチップ。 */
  header: ReactNode;
  /** 通知（トースト）。 */
  overlay: ReactNode;
  /** 録音を始める（再生位置から。途中なら差し込む）。 */
  onRecord: () => void;
  /** `at` を省くと再生位置に入る。入れた素材の id を返す（入れられなかったら null）。 */
  onInsertAsset: (a: AssetRow, at?: Smp) => Promise<string | null>;
  onOpenAssets: () => void;
  onShowToast: (text: string, undo?: () => void) => void;
  onError: (message: string) => void;
  /** 波形の拡大率（1 秒あたりの px）。タブを切り替えても保つため、エピソード画面が持つ（Issue #177）。 */
  pps: number;
  onZoom: (pps: number) => void;
}

const toSec = (s: number) => (s / 48000).toFixed(1);

/**
 * 収録タブの待機中・編集（見本 4.「編集」、DESIGN_SYSTEM.md §8）。無彩色とアクセントだけ。
 * 波形のパネル（目盛り・声のレーン・素材のレーン・再生ヘッド）、カンペ、下から出る選択のシート。
 * 録音中は `RecordingView` に切り替わる（Issue #122）。
 */
export function StudioTab({
  ws,
  recCtx,
  header,
  overlay,
  onRecord,
  onInsertAsset,
  onOpenAssets,
  onShowToast,
  onError,
  pps,
  onZoom,
}: StudioTabProps) {
  const c = useAppTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { state } = ws;
  // ハンドルを動かしている間の範囲（Issue #177）。離すまで `state.selection` は変わらない
  const [dragSel, setDragSel] = useState<Range | null>(null);
  const [sheet, setSheet] = useState<null | 'overlay' | 'insert'>(null);
  const [insertSide, setInsertSide] = useState<'before' | 'after'>('after');
  const [analyzing, setAnalyzing] = useState(false);
  const [fields, setFields] = useState<{ key: string; start: string; end: string } | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  // 開始・終了の秒数入力（読み上げでも選べるように。DESIGN_SYSTEM.md §8）。ふだんは畳んでおく
  const [numeric, setNumeric] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  /**
   * 入れた素材をその場で選び、素材のシートを開く（Issue #178）。挿入のシートが閉じ終わり、
   * 素材が入り終わってから開く（どちらが先に済むかは決まっていない）。
   */
  const afterInsert = useRef<{ id: string | null; dismissed: boolean } | null>(null);
  const openInserted = () => {
    const pending = afterInsert.current;
    if (!pending?.id || !pending.dismissed) return;
    afterInsert.current = null;
    ws.selectOverlay(pending.id);
    setSheet('overlay');
  };

  const sel = state.selection;
  const shown = dragSel ?? sel;
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
  const inputName = recCtx.inputKnown
    ? (recCtx.input?.name ?? t.record.builtInMic)
    : t.record.inputUnknown;
  const channels = recCtx.channels === 2 ? t.settings.stereo : t.settings.mono;
  const empty = state.total === 0;
  const inMiddle = state.playhead < state.total;

  /**
   * 調べて、そのまま詰める。取り消せる編集なので確認は出さず、件数と長さを「取り消す」付きで伝える
   * （FR-EDIT-3 / FR-UI-2、Issue #172）。
   */
  const trimSilence = useCallback(async () => {
    setAnalyzing(true);
    try {
      const plan = await ws.planSilence();
      if (plan.ranges.length === 0) {
        onShowToast(t.edit.silenceNone);
        return;
      }
      await ws.applySilencePlan(plan.ranges);
      onShowToast(
        t.edit.silenceApplied(plan.ranges.length, formatSmp(plan.totalRemoved, { tenths: true })),
        () => void ws.undo(),
      );
    } catch (e) {
      onError(String(e));
    } finally {
      setAnalyzing(false);
    }
  }, [onError, onShowToast, t, ws]);

  /** 選択を削除する。取り消せる編集なので確認は出さない（FR-EDIT-2 / FR-UI-2、Issue #172）。 */
  const doCut = useCallback(() => {
    if (!sel) return;
    const length = formatSmp(smp(sel.end - sel.start), { tenths: true });
    void ws.deleteSelection().then(() => onShowToast(t.edit.deleted(length), () => void ws.undo()));
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

  /** 選択の先頭から録る（見本「ここから録る」）。差し込みになる。 */
  const recordFromSelection = async () => {
    if (sel) await ws.seek(sel.start);
    onRecord();
  };

  // 見本 `.sheet`: 選択中は情報と「削除」「ここから録る」、選んでいなければ再生位置と「再生」「録音」
  const editSheet = (
    <View
      style={[
        st.sheet,
        { backgroundColor: c.surfaceRaised, paddingBottom: insets.bottom + space.xl },
      ]}
    >
      <View style={[st.grab, { backgroundColor: c.grabber }]} />
      {sel ? (
        <>
          {/* 見本 `.sheet .info`: 「選択中 <b>04:31.2 – 04:35.4</b> · 4.2 秒」。ハンドルを動かしている間はその位置 */}
          <Text
            style={[typography.caption, tabularNums, { color: c.textSecondary }]}
            accessibilityLiveRegion="polite"
          >
            {`${t.edit.selectedLabel} `}
            <Text style={[typography.captionStrong, { color: c.textPrimary }]}>
              {`${formatSmp(shown!.start, { tenths: true })} – ${formatSmp(shown!.end, { tenths: true })}`}
            </Text>
            {` · ${t.edit.seconds(toSec(shown!.end - shown!.start))}`}
          </Text>
          {numeric ? (
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
          ) : null}
          <View style={st.chips}>
            <Chip
              raised
              label={t.edit.playSelection}
              icon="play"
              onPress={() => void ws.playSelection()}
            />
            <Chip
              raised
              label={t.edit.insertBefore}
              icon="music"
              onPress={() => {
                setInsertSide('before');
                setSheet('insert');
              }}
            />
            <Chip
              raised
              label={t.edit.insertAfter}
              icon="music"
              onPress={() => {
                setInsertSide('after');
                setSheet('insert');
              }}
            />
            <Chip raised label={t.edit.clearSelection} onPress={ws.clearSelection} />
            <Chip
              raised
              label={t.edit.enterNumbers}
              active={numeric}
              onPress={() => setNumeric((v) => !v)}
            />
          </View>
          <View style={st.btns}>
            <Button
              label={t.common.delete}
              kind="secondary"
              icon="trash"
              style={st.flex}
              onPress={doCut}
            />
            <Button
              label={t.record.startHere}
              kind="inverse"
              icon="mic"
              iconSize={icon.inline}
              style={st.flex}
              onPress={() => void recordFromSelection()}
            />
          </View>
        </>
      ) : (
        <>
          <Text
            style={[typography.caption, tabularNums, { color: c.textSecondary }]}
            accessibilityLabel={t.edit.a11yPlayhead(
              formatSmp(state.playhead),
              formatSmp(state.total),
            )}
          >
            {`${t.edit.playheadInfo(formatSmp(state.playhead), formatSmp(state.total))} · ${t.record.inputLine(inputName, channels)}`}
          </Text>
          {empty ? null : (
            <View style={st.chips}>
              <Chip
                raised
                label={t.edit.removeSilence}
                icon="trimSilence"
                disabled={analyzing}
                onPress={() => void trimSilence()}
              />
              <Chip raised label={t.edit.insert} icon="plus" onPress={() => setSheet('insert')} />
              {/* 拡大・縮小（見本の波形のパネルには置かないので、選んでいないときのシートに置く） */}
              <Chip
                raised
                label={t.a11y.zoomOut}
                icon="minus"
                onPress={() => onZoom(Math.max(4, pps / 1.6))}
              />
              <Chip
                raised
                label={t.a11y.zoomIn}
                icon="plus"
                onPress={() => onZoom(Math.min(200, pps * 1.6))}
              />
            </View>
          )}
          <View style={st.btns}>
            <Button
              label={state.playing ? t.a11y.pause : t.a11y.play}
              kind="secondary"
              icon={state.playing ? 'pause' : 'play'}
              disabled={empty}
              style={st.flex}
              onPress={() => void ws.togglePlay()}
            />
            <Button
              label={inMiddle ? t.record.startHere : t.record.start}
              kind="inverse"
              icon="mic"
              iconSize={icon.inline}
              style={st.flex}
              onPress={onRecord}
            />
          </View>
        </>
      )}
      <Text style={[typography.small, tabularNums, { color: c.textTertiary }]}>
        {storageLine(t, recCtx, false)}
      </Text>
    </View>
  );

  return (
    <Screen edgeTop overlay={overlay} bottomBar={editSheet} bottomBarBare>
      {header}

      {empty ? (
        <Card>
          <Text style={[typography.heading, { color: c.textPrimary }]}>{t.edit.emptyTitle}</Text>
          <Text style={[typography.body, st.emptySub, { color: c.textSecondary }]}>
            {t.edit.emptySub}
          </Text>
        </Card>
      ) : (
        <View testID="timeline" style={[st.timeline, { backgroundColor: c.surface }]}>
          <Waveform
            voice={state.doc.voice}
            peaksByTake={state.peaksByTake}
            overlays={state.placedOverlays}
            assetNames={state.assets}
            events={ws.eventsOnTimeline}
            total={state.total}
            playhead={state.playhead}
            revealSeq={state.revealSeq}
            revealAt={state.revealAt}
            selection={sel}
            selectedOverlay={state.selectedOverlay}
            pps={pps}
            blocks={ws.blocks}
            onTap={(at: Smp, longPress: boolean) => void ws.tapAt(at, longPress)}
            onSelectionChange={(range: Range) => ws.setSelection(range)}
            onSelectionDrag={setDragSel}
            onSeek={(to: Smp) => void ws.seek(to)}
            onSelectOverlay={(oid: string | null) => {
              ws.selectOverlay(oid);
              if (oid) setSheet('overlay');
            }}
          />
        </View>
      )}

      {recCtx.input?.lowQuality ? (
        <Notice kind="warning" title={t.record.bluetoothTitle} body={t.settings.bluetoothWarning} />
      ) : null}

      {/* 見本 `.notesbox`: カンペ（FR-OUT-2）。鉛筆か本文を押すとシートで書く */}
      <View style={st.notes}>
        <View style={st.notesHead}>
          <Text
            style={[typography.subheading, st.flex, { color: c.textPrimary }]}
            accessibilityRole="header"
          >
            {t.notes.title}
          </Text>
          <IconButton name="edit" label={t.notes.a11yEdit} onPress={() => setNotesOpen(true)} />
        </View>
        <Pressable
          onPress={() => setNotesOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={
            state.notes.trim() ? `${t.notes.a11yEdit}, ${state.notes}` : t.notes.a11yEdit
          }
          style={({ pressed }) => [
            st.notesCard,
            { backgroundColor: pressed ? c.surfaceHover : c.surface },
          ]}
        >
          <Text
            style={[
              typography.body,
              { color: state.notes.trim() ? c.textPrimary : c.textSecondary },
            ]}
            numberOfLines={4}
          >
            {state.notes.trim() ? state.notes : t.notes.empty}
          </Text>
        </Pressable>
      </View>

      <NotesSheet ws={ws} open={notesOpen} onClose={() => setNotesOpen(false)} />

      <Sheet
        visible={sheet === 'insert'}
        onClose={() => setSheet(null)}
        onDismissed={() => {
          if (!afterInsert.current) return;
          afterInsert.current.dismissed = true;
          openInserted();
        }}
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
              afterInsert.current = { id: null, dismissed: false };
              setSheet(null);
              void onInsertAsset(a, insertPosition).then((id) => {
                const pending = afterInsert.current;
                if (!pending) return;
                if (!id) {
                  afterInsert.current = null;
                  return;
                }
                pending.id = id;
                openInserted();
              });
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
              onPress={() => {
                setSheet(null);
                void ws
                  .removeOverlay(selectedOverlay.id)
                  .then(() => onShowToast(t.edit.overlayRemoved, () => void ws.undo()));
              }}
            />
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const st = StyleSheet.create({
  flex: { flex: 1 },
  emptySub: { marginTop: space.xs },
  // 見本 `.timeline`: 角丸 8、上 12・下 14。
  timeline: {
    borderRadius: radius.sm,
    paddingTop: space.md,
    paddingBottom: space.x14,
    overflow: 'hidden',
  },
  // 見本 `.notesbox`: 上 14、間 6。本文の地は角丸 8、内側 上下 12・左右 14。
  notes: { marginTop: space.x14, gap: space.x6 },
  notesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  notesCard: { borderRadius: radius.sm, paddingVertical: space.md, paddingHorizontal: space.x14 },
  // 見本 `.sheet`: 上の角丸 14、上 12・左右 16・下 24、行の間 12。
  sheet: {
    borderTopLeftRadius: radius.x14,
    borderTopRightRadius: radius.x14,
    paddingTop: space.md,
    paddingHorizontal: space.lg,
    gap: space.md,
  },
  grab: { ...grabber, borderRadius: radius.pill, alignSelf: 'center' },
  fields: { flexDirection: 'row', gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  btns: { flexDirection: 'row', gap: space.sm },
  gainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderBottomWidth: stroke.hairline,
  },
  gainValue: { minWidth: 72, textAlign: 'center' },
});
