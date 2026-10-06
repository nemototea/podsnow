import { useCallback, useState, type ReactNode } from 'react';
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
import { grabber, radius, space, stroke, tabularNums, typography } from '@/ui/tokens';

import { parseSeconds, validateRange } from './selectionInput';
import { storageLine } from './storageLine';
import { TopicsSheet } from './TopicsSheet';
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
  /** `at` を省くと再生位置に入る。 */
  onInsertAsset: (a: AssetRow, at?: Smp) => void;
  onOpenAssets: () => void;
  onShowToast: (text: string, undo?: () => void) => void;
  onError: (message: string) => void;
}

const toSec = (s: number) => (s / 48000).toFixed(1);

/**
 * 収録タブの待機中・編集（見本 4.「編集」、DESIGN_SYSTEM.md §8）。無彩色とアクセントだけ。
 * 波形のパネル（目盛り・声のレーン・素材のレーン・再生ヘッド）、チャプターの一覧、下から出る選択のシート。
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
}: StudioTabProps) {
  const c = useAppTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { state } = ws;
  const [pps, setPps] = useState(24);
  const [sheet, setSheet] = useState<null | 'overlay' | 'insert'>(null);
  const [insertSide, setInsertSide] = useState<'before' | 'after'>('after');
  const [analyzing, setAnalyzing] = useState(false);
  const [fields, setFields] = useState<{ key: string; start: string; end: string } | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  // 開始・終了の秒数入力（読み上げでも選べるように。DESIGN_SYSTEM.md §8）。ふだんは畳んでおく
  const [numeric, setNumeric] = useState(false);
  const [topics, setTopics] = useState<{ open: boolean; focus: string | null }>({
    open: false,
    focus: null,
  });

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

  const playSelection = async () => {
    if (!sel) return;
    await ws.seek(sel.start);
    if (!state.playing) await ws.togglePlay();
  };

  /** 選択の先頭から録る（見本「ここから録る」）。差し込みになる。 */
  const recordFromSelection = async () => {
    if (sel) await ws.seek(sel.start);
    onRecord();
  };

  const chapters = ws.chaptersOnTimeline;

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
          <Text style={[typography.caption, tabularNums, { color: c.textSecondary }]}>
            {t.edit.selectedInfo(
              formatSmp(sel.start, { tenths: true }),
              formatSmp(sel.end, { tenths: true }),
              toSec(sel.end - sel.start),
            )}
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
              onPress={() => void playSelection()}
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
            chapters={chapters}
            events={ws.eventsOnTimeline}
            total={state.total}
            playhead={state.playhead}
            selection={sel}
            selectedOverlay={state.selectedOverlay}
            pps={pps}
            recording={false}
            recFrames={0}
            blocks={ws.blocks}
            onSelectBlock={(at: Smp) => {
              const b = ws.selectBlockAt(at);
              void ws.seek(b ? b.start : at);
            }}
            onSelectionChange={(range: Range) => ws.setSelection(range)}
            onSeek={(to: Smp) => void ws.seek(to)}
            onSelectOverlay={(oid: string | null) => {
              ws.selectOverlay(oid);
              if (oid) setSheet('overlay');
            }}
            onChapterPress={(item: { id: string }) => {
              const at = chapters.find((ch) => ch.item.id === item.id)?.at;
              if (at !== undefined) void ws.seek(at);
            }}
            onChapterLongPress={(item: { id: string }) => {
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
      )}

      {recCtx.input?.lowQuality ? (
        <Notice kind="warning" title={t.record.bluetoothTitle} body={t.settings.bluetoothWarning} />
      ) : null}

      {/* 見本 `.chapters`: トークテーマから作ったチャプター（FR-OUT-4） */}
      <View style={st.chapters}>
        <View style={st.chaptersHead}>
          <Text
            style={[typography.subheading, st.flex, { color: c.textPrimary }]}
            accessibilityRole="header"
          >
            {t.edit.chaptersTitle}
          </Text>
          <IconButton
            name="list"
            label={t.edit.editTopics}
            onPress={() => setTopics({ open: true, focus: null })}
          />
        </View>
        {state.outline.length === 0 ? (
          <Button
            label={t.record.addTopics}
            icon="plus"
            kind="secondary"
            onPress={() => setTopics({ open: true, focus: null })}
          />
        ) : (
          state.outline.map((item) => {
            const at = chapters.find((ch) => ch.item.id === item.id)?.at;
            return (
              <View key={item.id} style={st.chap}>
                <Pressable
                  onPress={() => (at === undefined ? undefined : void ws.seek(at))}
                  disabled={at === undefined}
                  accessibilityRole="button"
                  accessibilityLabel={t.edit.a11yChapter(item.heading)}
                  style={st.chapMain}
                >
                  <Text style={[typography.numeric, st.chapAt, { color: c.textSecondary }]}>
                    {at === undefined ? '—' : formatSmp(at)}
                  </Text>
                  <Text
                    style={[
                      typography.bodyStrong,
                      st.flex,
                      { color: at === undefined ? c.textSecondary : c.textPrimary },
                    ]}
                  >
                    {item.heading}
                  </Text>
                </Pressable>
                <IconButton
                  name="more"
                  label={t.edit.a11yChapterMenu(item.heading)}
                  onPress={() => setTopics({ open: true, focus: item.id })}
                />
              </View>
            );
          })
        )}
      </View>

      <TopicsSheet
        ws={ws}
        open={topics.open}
        focus={topics.focus}
        onClose={() => setTopics({ open: false, focus: null })}
      />

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
  zoom: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space.xs },
  // 見本 `.chapters`: 上 14、行の間 2。行は上下 8、時刻の幅 40、間 12。
  chapters: { marginTop: space.x14, gap: space.hair },
  chaptersHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.x6 },
  chap: { flexDirection: 'row', alignItems: 'center' },
  chapMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
  },
  chapAt: { width: space.xxxl },
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
