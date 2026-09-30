import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { moveItem } from '@/domain/outline';
import { formatClock } from '@/domain/time';
import { useT } from '@/i18n';
import { icon, radius, space, stroke, tabularNums, typography } from '@/ui/tokens';
import { Button, Field, Icon, IconButton, Row, SectionHeader, Sheet, Text } from '@/ui/components';
import { confirmDestructive } from '@/ui/alerts';
import { Sketchbook } from '@/ui/media';
import { ReorderList } from '@/ui/ReorderList';
import { useAppTheme } from '@/ui/ThemeContext';

import { useServices } from '../app/ServicesProvider';
import type { Workspace } from './useWorkspace';

/**
 * 話すこと（トークテーマと台本、FR-REC-6）。録音前・録音中・録音後のいつでも見られる。
 * 録音中は今の項目の台本を開き、次の項目へ送れる（FR-OUT-4）。
 */
export function TopicsSection({
  ws,
  onShowToast,
}: {
  ws: Workspace;
  onShowToast: (text: string) => void;
}) {
  const c = useAppTheme();
  const t = useT();
  const { state } = ws;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [body, setBody] = useState('');

  const currentIndex = ws.outlineCurrent;
  const current = currentIndex === null ? null : (state.outline[currentIndex] ?? null);
  const nextItem = ws.outlineNext === null ? null : (state.outline[ws.outlineNext] ?? null);
  const cueAt = new Map(ws.chaptersOnTimeline.map((ch) => [ch.item.id, ch.at] as const));
  const cueOf = (id: string): string | null => {
    const at = cueAt.get(id);
    return at === undefined ? null : formatClock(at);
  };
  const done = state.outline.filter((i) => i.recordedTakeId !== null).length;

  const { haptics } = useServices();
  const pick = useCallback(() => haptics.play('light'), [haptics]);
  const cross = useCallback(() => haptics.play('selection'), [haptics]);

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
      <SectionHeader
        title={t.record.talkingPoints}
        right={
          <View style={st.headRight}>
            {state.outline.length ? (
              <Text style={[typography.numeric, tabularNums, { color: c.textSecondary }]}>
                {t.record.progress(done, state.outline.length)}
              </Text>
            ) : null}
            <IconButton name="edit" label={t.record.openList} onPress={() => setOpen(true)} />
          </View>
        }
      />
      {state.outline.length === 0 ? (
        <Button
          label={t.record.addTopics}
          icon="plus"
          kind="secondary"
          onPress={() => setOpen(true)}
        />
      ) : (
        <View>
          {/* カンペ（DESIGN_SYSTEM.md §2.7）。話し始める前は表紙、話し始めたら今の話題の 1 ページ */}
          <Sketchbook
            page={
              current && currentIndex !== null
                ? {
                    key: current.id,
                    no: t.record.pageNo(currentIndex + 1),
                    progress: t.record.progress(currentIndex + 1, state.outline.length),
                    heading: current.heading,
                    body: current.body,
                    placeholder: t.record.addScript,
                    cue: cueOf(current.id) === null ? null : t.record.cue(cueOf(current.id)!),
                    next: nextItem ? t.record.upNext(nextItem.heading) : null,
                    a11y: `${t.record.talkingNow}, ${current.heading}${current.body.trim() ? `, ${current.body.trim()}` : ''}`,
                  }
                : null
            }
            cover={{
              title: t.record.talkingPoints,
              count: t.record.coverCount(state.outline.length),
              a11y: t.record.a11yCover(state.outline.length),
            }}
            remaining={
              currentIndex === null ? state.outline.length : state.outline.length - 1 - currentIndex
            }
            {...(current ? { onPressPage: () => openBody(current.id, current.body) } : {})}
          />
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
          {/* 全部の話題の目次。送った項目には時刻（CUE の位置）を並べる */}
          <View style={[st.index, { borderTopColor: c.controlBorder }]}>
            {state.outline.map((item, i) => {
              const isCurrent = current?.id === item.id;
              const passed = item.recordedTakeId !== null && !isCurrent;
              const cue = cueOf(item.id);
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
                  accessibilityLabel={`${item.heading}${passed ? `, ${t.record.a11yTalked}` : isCurrent ? `, ${t.record.talkingNow}` : ''}${cue ? `, ${t.record.a11yCue(cue)}` : ''}`}
                >
                  <Text style={[typography.numeric, st.no, { color: c.textSecondary }]}>
                    {String(i + 1).padStart(2, '0')}
                  </Text>
                  <View
                    style={[
                      st.check,
                      {
                        borderColor: c.controlBorder,
                        backgroundColor: passed
                          ? c.textPrimary
                          : isCurrent
                            ? c.brandShadow
                            : 'transparent',
                      },
                    ]}
                  >
                    {passed ? <Icon name="check" color={c.bg} size={icon.sm} /> : null}
                  </View>
                  <Text
                    style={[
                      isCurrent ? typography.bodyStrong : typography.body,
                      st.flex,
                      { color: passed ? c.textSecondary : c.textPrimary },
                    ]}
                  >
                    {item.heading}
                  </Text>
                  {cue ? (
                    <Text style={[typography.numeric, { color: c.textSecondary }]}>{cue}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      )}

      <Sheet visible={open} onClose={() => setOpen(false)} title={t.record.topicsTitle}>
        <ReorderList
          items={state.outline}
          keyOf={(item) => item.id}
          labelOf={(item) => item.heading}
          onMove={(from, to) => ws.saveOutline(moveItem(state.outline, from, to))}
          onPick={pick}
          onCross={cross}
          renderItem={(item, i, { grip, a11y }) => (
            <Row
              label={item.heading}
              sub={item.body.trim() ? item.body.trim() : t.record.addScript}
              onPress={() => openBody(item.id, item.body)}
              last={i === state.outline.length - 1}
              {...a11y}
              right={
                <View style={st.rowActions}>
                  <IconButton
                    name="trash"
                    label={t.record.a11yDeleteTopic(item.heading)}
                    color={c.dangerText}
                    onPress={() =>
                      confirmDestructive({
                        title: t.record.confirmDeleteTopic(item.heading),
                        ...(item.body.trim() ? { message: t.record.confirmDeleteTopicNote } : {}),
                        confirmLabel: t.common.delete,
                        cancelLabel: t.common.cancel,
                        onConfirm: () =>
                          void ws.saveOutline(state.outline.filter((x) => x.id !== item.id)),
                      })
                    }
                  />
                  {grip}
                </View>
              }
            />
          )}
        />
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
    </View>
  );
}

const st = StyleSheet.create({
  headRight: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginRight: -space.md },
  index: { borderTopWidth: stroke.selected, marginTop: space.lg },
  topic: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    minHeight: space.section,
  },
  no: { minWidth: space.xl },
  flex: { flex: 1 },
  check: {
    width: icon.md,
    height: icon.md,
    borderRadius: radius.xs,
    borderWidth: stroke.selected,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextTopic: { marginTop: space.md },
  rowActions: { flexDirection: 'row', alignItems: 'center', marginRight: -space.md },
});
