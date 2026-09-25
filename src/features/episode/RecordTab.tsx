import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { moveItem } from '@/domain/outline';
import { formatClock, formatSmp, smp } from '@/domain/time';
import { useT, type Messages } from '@/i18n';
import type { AssetRow } from '@/infra/db/repositories/assetsRepo';
import type { SessionState } from '@/services/recording/RecordingSession';
import { hit, icon, radius, space, stroke, tabularNums, typography } from '@/ui/tokens';
import {
  Button,
  Field,
  Icon,
  IconButton,
  Notice,
  Row,
  SectionHeader,
  Sheet,
  Text,
  useCompact,
  type IconName,
} from '@/ui/components';
import { Display, DisplayCells, Key, Led, PanelLabel, useKeyInk } from '@/ui/device';
import { useAppTheme } from '@/ui/ThemeContext';

import { LevelMeter } from './LevelMeter';
import type { RecordingContext } from './useRecordingContext';
import type { Workspace } from './useWorkspace';

export interface RecordTabProps {
  ws: Workspace;
  recCtx: RecordingContext;
  onInsertAsset: (a: AssetRow) => void;
  onOpenAssets: () => void;
  onShowToast: (text: string) => void;
}

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

export function RecordTab({
  ws,
  recCtx,
  onInsertAsset,
  onOpenAssets,
  onShowToast,
}: RecordTabProps) {
  const c = useAppTheme();
  const t = useT();
  const compactTimer = useCompact();
  const { state } = ws;
  const [sheet, setSheet] = useState<null | 'topics' | 'insert'>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [body, setBody] = useState('');

  const s = state.recording;
  const isRec = s === 'recording' || s === 'paused';
  const active = isRec;
  const keyInk = useKeyInk();
  const live = isRec || s === 'interrupted';
  const label = stateLabel(t, s);
  const stateColor = s === 'interrupted' ? c.dispMistake : c.dispDim;
  const current = ws.outlineCurrent === null ? null : (state.outline[ws.outlineCurrent] ?? null);
  const done = state.outline.filter((i) => i.recordedTakeId !== null).length;
  const favorites = state.assets.filter(
    (a) => a.is_favorite && (a.kind === 'jingle' || a.kind === 'sfx'),
  );
  const inputName = recCtx.inputKnown
    ? (recCtx.input?.name ?? t.record.builtInMic)
    : t.record.inputUnknown;
  const channels = recCtx.channels === 2 ? t.settings.stereo : t.settings.mono;

  const openBody = (id: string, value: string) => {
    setEditing(id);
    setBody(value);
  };
  const commitBody = () => {
    if (editing)
      void ws.saveOutline(state.outline.map((i) => (i.id === editing ? { ...i, body } : i)));
    setEditing(null);
  };

  const cells = [
    { label: t.record.cellInput, value: inputName },
    { label: t.record.cellFormat, value: t.record.formatValue(channels) },
    active && !recCtx.writerOk
      ? { label: t.record.cellLeft, value: t.record.notSaving, tone: 'alert' as const }
      : {
          label: t.record.cellLeft,
          value: recCtx.estimate
            ? t.record.leftValue(
                recCtx.estimate.unit === 'hours'
                  ? t.record.hours(recCtx.estimate.value)
                  : t.record.minutes(recCtx.estimate.value),
              )
            : t.record.leftUnknown,
        },
  ];
  const shown = current ?? (ws.outlineNext !== null ? state.outline[ws.outlineNext] : null) ?? null;
  const upcoming = current && ws.outlineNext !== null ? state.outline[ws.outlineNext] : null;

  return (
    <View style={st.root}>
      {/* 見るもの：状態・時間・レベル・入力・形式・残りを 1 枚の表示窓にまとめる（PN-01、#115） */}
      <Display>
        <View style={st.dispTop}>
          {s === 'recording' ? (
            <View style={[st.onAir, { backgroundColor: c.dispRecSubtle, borderColor: c.dispRec }]}>
              <Led color={c.dispRec} />
              <Text style={[typography.overline, { color: c.dispRecText }]}>{t.record.onAir}</Text>
            </View>
          ) : null}
          {label ? (
            <View style={st.stateLabel} accessibilityLiveRegion="polite">
              {label.icon && s !== 'recording' ? (
                <Icon name={label.icon} color={stateColor} size={icon.sm} />
              ) : null}
              <Text style={[typography.overline, { color: stateColor }]}>{label.text}</Text>
            </View>
          ) : null}
          <View style={st.flex} />
          <Text style={[typography.overline, { color: c.dispDim }]}>
            {live ? t.record.takeLabel(state.takes.length + 1) : ''}
          </Text>
        </View>
        <Text
          style={[
            compactTimer ? typography.timer : typography.timerDisplay,
            tabularNums,
            st.timer,
            { color: c.dispInk },
          ]}
          accessibilityLabel={
            live
              ? t.record.a11yElapsed(formatClock(smp(state.recFrames)))
              : t.record.a11yRecordedSoFar(formatClock(state.total))
          }
        >
          {formatClock(live ? smp(state.recFrames) : state.total)}
        </Text>
        <LevelMeter level={isRec && s === 'recording' ? state.level : null} />
        <DisplayCells cells={cells} />
      </Display>
      {recCtx.input?.lowQuality ? (
        <Notice kind="warning" title={t.record.bluetoothTitle} body={t.settings.bluetoothWarning} />
      ) : null}

      {/* 話すこと：今の話題と次の話題。右のキーで送る。表示窓を押すと一覧を開く */}
      {state.outline.length === 0 ? (
        <Button
          label={t.record.addTopics}
          icon="plus"
          kind="secondary"
          onPress={() => setSheet('topics')}
        />
      ) : (
        <View style={st.topicRow}>
          <Pressable
            style={st.flex}
            onPress={() => setSheet('topics')}
            accessibilityRole="button"
            accessibilityLabel={`${t.record.talkingPoints} ${t.record.progress(done, state.outline.length)}, ${shown?.heading ?? ''}`}
            accessibilityHint={t.record.openList}
          >
            <Display innerStyle={st.topicInner}>
              <View style={st.topicHead}>
                <Text style={[typography.overline, { color: c.dispDim }]}>
                  {t.record.talkingPoints}
                </Text>
                <Text style={[typography.tick, tabularNums, { color: c.dispDim }]}>
                  {t.record.progress(done, state.outline.length)}
                </Text>
              </View>
              <Text style={[typography.bodyStrong, { color: c.dispInk }]} numberOfLines={2}>
                {shown?.heading ?? ''}
              </Text>
              {current && current.body.trim() ? (
                <Text style={[typography.caption, { color: c.dispDim }]} numberOfLines={3}>
                  {current.body}
                </Text>
              ) : null}
              {upcoming ? (
                <Text style={[typography.caption, { color: c.dispDim }]} numberOfLines={1}>
                  {t.record.nextTopic(upcoming.heading)}
                </Text>
              ) : null}
            </Display>
          </Pressable>
          {ws.outlineNext !== null ? (
            <Key
              label={t.record.a11yNextTopic(state.outline[ws.outlineNext]?.heading ?? '')}
              onPress={() =>
                void ws
                  .advanceOutline()
                  .then((it) => it && onShowToast(t.record.advanced(it.heading)))
              }
              style={st.stepKey}
            >
              <Icon name="down" color={keyInk} size={icon.sm} />
            </Key>
          ) : null}
        </View>
      )}

      {/* 触るもの：素材のパッド。押す面は同じで、色は上辺の灯りだけ */}
      <PanelLabel
        title={t.record.assetsTitle}
        right={
          favorites.length ? (
            <Text style={[typography.numeric, tabularNums, { color: c.textSecondary }]}>
              {favorites.length}
            </Text>
          ) : null
        }
      />
      {favorites.length === 0 ? (
        <Button
          label={t.record.registerAssets}
          icon="plus"
          kind="secondary"
          onPress={onOpenAssets}
        />
      ) : (
        <View style={st.pads}>
          {favorites.slice(0, 3).map((a) => (
            <View key={a.id} style={st.padCell}>
              <Key
                label={isRec ? t.record.a11yInsertNow(a.name) : t.record.a11yInsertAt(a.name)}
                caption={a.name}
                onPress={() => onInsertAsset(a)}
                style={st.pad}
              >
                <View style={[st.padLed, { backgroundColor: c.insertSolid }]} />
                <Icon name="music" color={keyInk} size={icon.sm} />
              </Key>
            </View>
          ))}
          <View style={st.padCell}>
            <Key
              label={t.record.moreAssets}
              caption={t.record.moreAssets}
              onPress={() => setSheet('insert')}
              style={st.pad}
            >
              <Icon name="more" color={keyInk} size={icon.sm} />
            </Key>
          </View>
        </View>
      )}

      {state.doc.voice.length ? <SectionHeader title={t.record.recordingsEyebrow} /> : null}
      {state.doc.voice.map((v, i) => {
        const take = state.takes.find((x) => x.id === v.takeId);
        const last = i === state.doc.voice.length - 1;
        return (
          <Row
            key={v.id}
            label={take?.name ?? ''}
            sub={formatSmp(smp(v.srcEnd - v.srcStart))}
            last={last}
            right={
              <View style={st.rowActions}>
                <IconButton
                  name="up"
                  label={t.common.moveUp}
                  disabled={i === 0 || live}
                  onPress={() => void ws.moveTake(i, i - 1)}
                />
                <IconButton
                  name="down"
                  label={t.common.moveDown}
                  disabled={last || live}
                  onPress={() => void ws.moveTake(i, i + 1)}
                />
                <IconButton
                  name="close"
                  label={t.record.a11yRemoveFromEpisode(take?.name ?? '')}
                  disabled={live}
                  onPress={() => {
                    void ws.removeVoiceSegment(i);
                    onShowToast(t.record.removedFromEpisode);
                  }}
                />
              </View>
            }
          />
        );
      })}

      <Sheet
        visible={sheet === 'topics'}
        onClose={() => setSheet(null)}
        title={t.record.topicsTitle}
      >
        {state.outline.map((item, i) => (
          <Row
            key={item.id}
            label={item.heading}
            sub={item.body.trim() ? item.body.trim() : t.record.addScript}
            onPress={() => openBody(item.id, item.body)}
            right={
              <View style={st.rowActions}>
                <IconButton
                  name="up"
                  label={t.common.moveUp}
                  disabled={i === 0}
                  onPress={() => void ws.saveOutline(moveItem(state.outline, i, i - 1))}
                />
                <IconButton
                  name="down"
                  label={t.common.moveDown}
                  disabled={i === state.outline.length - 1}
                  onPress={() => void ws.saveOutline(moveItem(state.outline, i, i + 1))}
                />
                <IconButton
                  name="trash"
                  label={t.record.a11yDeleteTopic(item.heading)}
                  color={c.dangerText}
                  onPress={() => void ws.saveOutline(state.outline.filter((x) => x.id !== item.id))}
                />
              </View>
            }
          />
        ))}
        <View style={{ marginTop: space.md }}>
          <Field
            label={t.record.addTopics}
            value={draft}
            onChangeText={setDraft}
            placeholder={t.record.topicsPlaceholder}
            multiline
          />
          <Button
            label={t.common.add}
            kind="secondary"
            icon="plus"
            disabled={!draft.trim()}
            onPress={() => {
              const text = draft;
              setDraft('');
              void ws.addOutlineFromText(text);
            }}
          />
        </View>
      </Sheet>

      <Sheet visible={!!editing} onClose={commitBody} title={t.record.scriptTitle}>
        <Field
          label={t.record.scriptTitle}
          value={body}
          onChangeText={setBody}
          placeholder={t.record.scriptPlaceholder}
          multiline
        />
        <Button label={t.common.save} onPress={commitBody} />
      </Sheet>

      <Sheet
        visible={sheet === 'insert'}
        onClose={() => setSheet(null)}
        title={t.record.insertTitle}
        subtitle={isRec ? t.record.insertSubRecording : t.record.insertSubPlayhead}
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
              onInsertAsset(a);
            }}
          />
        ))}
      </Sheet>
    </View>
  );
}

const st = StyleSheet.create({
  root: { gap: space.lg },
  flex: { flex: 1 },
  dispTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    minHeight: space.xl + space.md,
  },
  onAir: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + stroke.selected,
    paddingHorizontal: space.sm,
    height: space.xl,
    borderRadius: radius.xs + stroke.selected,
    borderWidth: stroke.hairline,
  },
  stateLabel: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  timer: { paddingHorizontal: space.md, marginTop: space.xs },
  topicRow: { flexDirection: 'row', gap: space.sm, alignItems: 'stretch' },
  topicInner: {
    paddingHorizontal: space.md,
    paddingVertical: space.md - stroke.selected,
    gap: space.hair,
  },
  topicHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stepKey: { width: hit.min, flex: 1, minHeight: hit.min },
  pads: { flexDirection: 'row', gap: space.md, marginTop: -space.sm },
  padCell: { flex: 1, minWidth: 0 },
  pad: { width: '100%', height: hit.secondary + space.xs, gap: space.xs },
  padLed: {
    position: 'absolute',
    top: space.sm,
    left: space.md,
    right: space.md,
    height: stroke.focus,
    borderRadius: radius.pill,
  },
  rowActions: { flexDirection: 'row', alignItems: 'center', marginRight: -space.md },
});
