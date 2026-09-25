import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { moveItem } from '@/domain/outline';
import { formatClock, formatSmp, smp } from '@/domain/time';
import { useT, type Messages } from '@/i18n';
import type { AssetRow } from '@/infra/db/repositories/assetsRepo';
import type { SessionState } from '@/services/recording/RecordingSession';
import { icon, radius, space, stroke, tabularNums, typography } from '@/ui/tokens';
import {
  Button,
  Chip,
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
  const live = isRec || s === 'interrupted';
  const label = stateLabel(t, s);
  const stateColor =
    s === 'recording' ? c.recText : s === 'interrupted' ? c.mistakeText : c.textSecondary;
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

  return (
    <View>
      {/* 待機中も行の高さは取っておく。録音を始めた瞬間にタイマーやメーターが下へずれないように。 */}
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

      <Text
        style={[
          compactTimer ? typography.timerCompact : typography.timer,
          tabularNums,
          { color: c.textPrimary },
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

      <SectionHeader
        title={t.record.talkingPoints}
        right={
          <View style={st.headRight}>
            {state.outline.length ? (
              <Text style={[typography.numeric, tabularNums, { color: c.textSecondary }]}>
                {t.record.progress(done, state.outline.length)}
              </Text>
            ) : null}
            <IconButton name="edit" label={t.record.openList} onPress={() => setSheet('topics')} />
          </View>
        }
      />
      {state.outline.length === 0 ? (
        <Button
          label={t.record.addTopics}
          icon="plus"
          kind="secondary"
          onPress={() => setSheet('topics')}
        />
      ) : (
        <View>
          {state.outline.map((item, i) => {
            const isCurrent = current?.id === item.id;
            const passed = item.recordedTakeId !== null && !isCurrent;
            return (
              <View
                key={item.id}
                style={[
                  st.topic,
                  {
                    borderBottomColor: c.border,
                    borderBottomWidth:
                      i === state.outline.length - 1 ? 0 : StyleSheet.hairlineWidth,
                  },
                ]}
                accessibilityLabel={`${item.heading}${passed ? `, ${t.record.a11yTalked}` : isCurrent ? `, ${t.record.talkingNow}` : ''}`}
              >
                <View
                  style={[
                    st.check,
                    {
                      borderColor: passed || isCurrent ? c.accentBorder : c.borderStrong,
                      backgroundColor: passed ? c.accentSubtle : 'transparent',
                    },
                  ]}
                >
                  {passed ? <Icon name="check" color={c.accentText} size={icon.sm} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      isCurrent ? typography.bodyStrong : typography.body,
                      { color: passed ? c.textSecondary : c.textPrimary },
                    ]}
                  >
                    {item.heading}
                  </Text>
                  {isCurrent && item.body.trim() ? (
                    <Text style={[typography.body, { color: c.textSecondary }]}>{item.body}</Text>
                  ) : null}
                </View>
              </View>
            );
          })}
          {ws.outlineNext !== null ? (
            <Button
              label={
                current
                  ? t.record.nextTopic(state.outline[ws.outlineNext]?.heading ?? '')
                  : t.record.firstTopic(state.outline[ws.outlineNext]?.heading ?? '')
              }
              kind="secondary"
              style={st.nextTopic}
              onPress={() =>
                void ws
                  .advanceOutline()
                  .then((it) => it && onShowToast(t.record.advanced(it.heading)))
              }
            />
          ) : null}
        </View>
      )}

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
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    minHeight: typography.label.lineHeight,
  },
  stateLabel: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginRight: -space.md },
  topic: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: space.md,
  },
  check: {
    width: icon.md,
    height: icon.md,
    marginTop: space.hair,
    borderRadius: radius.xs,
    borderWidth: stroke.selected,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextTopic: { marginTop: space.md },
  assets: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  rowActions: { flexDirection: 'row', alignItems: 'center', marginRight: -space.md },
});
