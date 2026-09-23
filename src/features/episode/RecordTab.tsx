import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { moveItem } from '@/domain/outline';
import { formatSmp, smp } from '@/domain/time';
import { useT } from '@/i18n';
import type { AssetRow } from '@/infra/db/repositories/assetsRepo';
import { glyphSlop, hit, radius, space, typography } from '@/ui/tokens';
import { Button, Card, Chip, Eyebrow, Row, Sheet } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';

import { Waveform } from './Waveform';
import type { Workspace } from './useWorkspace';

export interface RecordTabProps {
  ws: Workspace;
  /** お気に入りの素材（下部のボタンに出す分は呼び出し側で絞る）。 */
  onInsertAsset: (a: AssetRow) => void;
  onOpenAssets: () => void;
  onShowToast: (text: string) => void;
}

/**
 * 録音タブ（docs/ux-restructure.md §5）。
 * 収録前・収録中・収録後のどれでも、この 1 画面でトークテーマと台本を読み書きできる。
 */
export function RecordTab({ ws, onInsertAsset, onOpenAssets, onShowToast }: RecordTabProps) {
  const c = useAppTheme();
  const t = useT();
  const { state } = ws;
  const [sheet, setSheet] = useState<null | 'topics' | 'insert'>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [body, setBody] = useState('');

  const isRec = state.recording === 'recording' || state.recording === 'paused';
  const current = ws.outlineCurrent === null ? null : (state.outline[ws.outlineCurrent] ?? null);
  const upNext = ws.outlineNext === null ? null : (state.outline[ws.outlineNext] ?? null);
  const levelPct = state.level ? Math.max(0, Math.min(1, (state.level.rmsDb + 60) / 60)) : 0;
  const favorites = state.assets.filter(
    (a) => a.is_favorite && (a.kind === 'jingle' || a.kind === 'sfx'),
  );

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
    <View style={{ flex: 1 }}>
      {/* 状態行 */}
      <View style={st.statusRow}>
        {isRec ? (
          <View style={[st.recPill, { borderColor: c.recSolid }]}>
            <View style={[st.recDot, { backgroundColor: c.recSolid }]} />
            <Text style={[typography.overline, { color: c.dangerText }]}>
              {formatSmp(smp(state.recFrames))}
            </Text>
          </View>
        ) : null}
        <Text style={[typography.caption, { color: c.textSecondary, flex: 1 }]} numberOfLines={1}>
          {state.takes.length
            ? t.record.recordedSoFar(state.takes.length, formatSmp(state.total))
            : t.record.notRecordedYet}
        </Text>
      </View>
      {isRec ? (
        <View style={[st.meterTrack, { backgroundColor: c.surface }]}>
          <View
            style={[
              st.meterFill,
              {
                width: `${levelPct * 100}%`,
                backgroundColor: state.level?.clipped ? c.recSolid : c.voiceSolid,
              },
            ]}
          />
        </View>
      ) : null}

      {/* 話す内容 */}
      {state.outline.length > 0 ? (
        <View style={[st.cue, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[typography.overline, { color: c.textSecondary }]}>
            {current ? t.record.talkingNow : t.record.notStarted}
          </Text>
          <Text style={[typography.title, { color: c.textPrimary }]} numberOfLines={2}>
            {(current ?? state.outline[0])?.heading ?? ''}
          </Text>
          {(current ?? state.outline[0])?.body.trim() ? (
            <Text style={{ color: c.textSecondary, lineHeight: 22 }} numberOfLines={6}>
              {(current ?? state.outline[0])?.body}
            </Text>
          ) : null}
          <View style={st.cueFoot}>
            <Text
              style={[typography.caption, { color: c.textTertiary, flex: 1 }]}
              numberOfLines={1}
            >
              {upNext ? t.record.upNext(upNext.heading) : t.record.allDone}
            </Text>
            {upNext ? (
              <Chip
                label={t.record.next}
                active
                onPress={() =>
                  void ws
                    .advanceOutline()
                    .then((i) => i && onShowToast(t.record.advanced(i.heading)))
                }
              />
            ) : null}
            <Chip label={t.record.openList} onPress={() => setSheet('topics')} />
          </View>
          <View style={st.dots}>
            {state.outline.map((i) => (
              <View
                key={i.id}
                style={[
                  st.dot,
                  {
                    backgroundColor: i.recordedTakeId !== null ? c.accentSolid : c.borderStrong,
                  },
                ]}
              />
            ))}
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setSheet('topics')} style={st.emptyCue}>
          <Text style={[typography.body, { color: c.textSecondary }]}>{t.record.writeTopics}</Text>
          <Text style={[typography.caption, { color: c.textTertiary }]}>
            {t.record.writeTopicsSub}
          </Text>
        </Pressable>
      )}

      {/* 波形（録音中は小さくてよい。レベルで足りる） */}
      <Waveform
        voice={state.doc.voice}
        peaksByTake={state.peaksByTake}
        overlays={state.placedOverlays}
        chapters={ws.chaptersOnTimeline}
        events={ws.eventsOnTimeline}
        total={state.total}
        playhead={state.playhead}
        selection={null}
        selectedOverlay={null}
        pps={12}
        recording={isRec}
        recFrames={state.recFrames}
        compact
        onSeek={(to) => {
          if (!isRec) void ws.seek(to);
        }}
        onSelectOverlay={() => {}}
        onChapterPress={(item) => {
          const at = ws.chaptersOnTimeline.find((ch) => ch.item.id === item.id)?.at;
          if (at !== undefined && !isRec) void ws.seek(at);
        }}
      />

      {/* 素材 */}
      <View style={st.assets}>
        {favorites.length === 0 ? (
          <Pressable onPress={onOpenAssets} hitSlop={glyphSlop}>
            <Text style={[typography.caption, { color: c.accentText }]}>
              {t.record.registerAssets}
            </Text>
          </Pressable>
        ) : (
          <>
            {favorites.slice(0, 4).map((a) => (
              <Chip key={a.id} label={a.name} onPress={() => onInsertAsset(a)} />
            ))}
            <Chip label={t.record.moreAssets} onPress={() => setSheet('insert')} />
          </>
        )}
      </View>

      {/* この回の録音 */}
      <Eyebrow>{t.record.recordingsEyebrow}</Eyebrow>
      <Card style={{ paddingVertical: space.xs }}>
        {state.doc.voice.length === 0 ? (
          <Text style={{ color: c.textTertiary, paddingVertical: space.md }}>
            {t.record.noRecordings}
          </Text>
        ) : null}
        {state.doc.voice.map((v, i) => {
          const take = state.takes.find((x) => x.id === v.takeId);
          return (
            <Row
              key={v.id}
              label={take?.name ?? ''}
              sub={formatSmp(smp(v.srcEnd - v.srcStart))}
              right={
                <View style={{ flexDirection: 'row', gap: space.lg }}>
                  <Pressable
                    onPress={() => void ws.moveTake(i, i - 1)}
                    disabled={i === 0}
                    hitSlop={glyphSlop}
                    accessibilityLabel={t.common.moveUp}
                  >
                    <Text style={{ color: i === 0 ? c.textTertiary : c.textPrimary }}>↑</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void ws.moveTake(i, i + 1)}
                    disabled={i === state.doc.voice.length - 1}
                    hitSlop={glyphSlop}
                    accessibilityLabel={t.common.moveDown}
                  >
                    <Text
                      style={{
                        color: i === state.doc.voice.length - 1 ? c.textTertiary : c.textPrimary,
                      }}
                    >
                      ↓
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      void ws.removeVoiceSegment(i);
                      onShowToast(t.record.removedFromEpisode);
                    }}
                    hitSlop={glyphSlop}
                    accessibilityLabel={t.common.delete}
                  >
                    <Text style={{ color: c.dangerText }}>✕</Text>
                  </Pressable>
                </View>
              }
            />
          );
        })}
      </Card>

      {/* トークテーマと台本 */}
      <Sheet
        visible={sheet === 'topics'}
        onClose={() => setSheet(null)}
        title={t.record.topicsTitle}
        subtitle={t.record.topicsSubtitle}
      >
        {state.outline.length === 0 ? (
          <Text style={{ color: c.textSecondary, marginBottom: space.md }}>
            {t.record.topicsEmpty}
          </Text>
        ) : null}
        {state.outline.map((item, i) => (
          <Row
            key={item.id}
            label={item.heading}
            sub={item.body.trim() ? item.body.trim() : t.record.addScript}
            onPress={() => openBody(item.id, item.body)}
            right={
              <View style={{ flexDirection: 'row', gap: space.lg }}>
                <Pressable
                  onPress={() => void ws.saveOutline(moveItem(state.outline, i, i - 1))}
                  disabled={i === 0}
                  hitSlop={glyphSlop}
                  accessibilityLabel={t.common.moveUp}
                >
                  <Text style={{ color: i === 0 ? c.textTertiary : c.textPrimary }}>↑</Text>
                </Pressable>
                <Pressable
                  onPress={() => void ws.saveOutline(moveItem(state.outline, i, i + 1))}
                  disabled={i === state.outline.length - 1}
                  hitSlop={glyphSlop}
                  accessibilityLabel={t.common.moveDown}
                >
                  <Text
                    style={{
                      color: i === state.outline.length - 1 ? c.textTertiary : c.textPrimary,
                    }}
                  >
                    ↓
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void ws.saveOutline(state.outline.filter((x) => x.id !== item.id))}
                  hitSlop={glyphSlop}
                  accessibilityLabel={t.common.delete}
                >
                  <Text style={{ color: c.dangerText }}>✕</Text>
                </Pressable>
              </View>
            }
          />
        ))}
        <View style={{ marginTop: space.md, gap: space.sm }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t.record.topicsPlaceholder}
            placeholderTextColor={c.textTertiary}
            multiline
            style={[
              st.input,
              { color: c.textPrimary, borderColor: c.border, backgroundColor: c.surfaceRaised },
            ]}
            accessibilityLabel={t.record.topicsTitle}
          />
          <Button
            label={t.common.add}
            kind="secondary"
            onPress={() => {
              const text = draft;
              setDraft('');
              void ws.addOutlineFromText(text);
            }}
          />
        </View>
      </Sheet>

      {/* 台本の本文 */}
      <Sheet visible={!!editing} onClose={commitBody} title={t.record.scriptTitle}>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={t.record.scriptPlaceholder}
          placeholderTextColor={c.textTertiary}
          multiline
          textAlignVertical="top"
          style={[
            st.input,
            {
              color: c.textPrimary,
              borderColor: c.border,
              backgroundColor: c.surfaceRaised,
              minHeight: 160,
            },
          ]}
          accessibilityLabel={t.record.scriptTitle}
        />
        <Button label={t.common.save} onPress={commitBody} style={{ marginTop: space.md }} />
      </Sheet>

      {/* 素材の一覧 */}
      <Sheet
        visible={sheet === 'insert'}
        onClose={() => setSheet(null)}
        title={t.record.insertTitle}
        subtitle={isRec ? t.record.insertSubRecording : t.record.insertSubPlayhead}
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
    </View>
  );
}

const st = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xs,
  },
  recPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: space.hair,
  },
  recDot: { width: space.sm, height: space.sm, borderRadius: radius.pill },
  meterTrack: { height: space.xs, borderRadius: radius.xs, overflow: 'hidden' },
  meterFill: { height: space.xs },
  cue: {
    marginTop: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space.sm,
  },
  cueFoot: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dots: { flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' },
  dot: { width: space.sm, height: space.sm, borderRadius: radius.pill },
  emptyCue: {
    marginTop: space.sm,
    paddingVertical: space.lg,
    gap: space.xs,
  },
  assets: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingVertical: space.sm },
  input: {
    ...typography.body,
    minHeight: hit.min,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
});
