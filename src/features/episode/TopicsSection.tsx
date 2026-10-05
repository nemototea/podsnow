import { useCallback, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { moveItem } from '@/domain/outline';
import { formatClock } from '@/domain/time';
import { useT } from '@/i18n';
import { space, tabularNums, typography } from '@/ui/tokens';
import { Button, Field, IconButton, Row, SectionHeader, Text } from '@/ui/components';
import { Sheet } from '@/ui/Sheet';
import { confirmDestructive } from '@/ui/alerts';
import { indexTabs, Sketchbook } from '@/ui/media';
import { ReorderList } from '@/ui/ReorderList';
import { useAppTheme } from '@/ui/ThemeContext';

import { useServices } from '../app/ServicesProvider';
import type { Workspace } from './useWorkspace';

/**
 * 話すこと（トークテーマと台本、FR-REC-6）。録音前・録音中・録音後のいつでも見られる。
 * 録音中は今の項目の台本を開き、次の項目へ送れる（FR-OUT-4）。
 */
export function TopicsSection({ ws }: { ws: Workspace }) {
  const c = useAppTheme();
  const t = useT();
  const { state } = ws;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [body, setBody] = useState('');
  // 付箋から開いたときに、押した話題を全体のシートで示す（見るだけで、話題は進めない）
  const [focus, setFocus] = useState<string | null>(null);
  // 全体のシートの行の高さ。押した話題の上端（= それより前の行の高さの和）まで送るのに使う
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const focusIndex = focus === null ? -1 : state.outline.findIndex((i) => i.id === focus);
  const before = focusIndex < 0 ? [] : state.outline.slice(0, focusIndex);
  const scrollTo =
    focusIndex < 0 || before.some((i) => rowHeights[i.id] === undefined)
      ? null
      : before.reduce((y, i) => y + rowHeights[i.id]!, 0);
  const openOverview = (id: string | null) => {
    setFocus(id);
    setOpen(true);
  };

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
            <IconButton name="list" label={t.record.openList} onPress={() => setOpen(true)} />
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
                    a11y: `${t.record.talkingNow}, ${current.heading}${current.body.trim() ? `, ${current.body.trim()}` : ''}. ${t.record.a11yIndex(currentIndex + 1, state.outline.length, done, state.outline.length - 1 - currentIndex)}`,
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
            tabs={indexTabs(state.outline.length, currentIndex).map((tab) => {
              if (tab.kind !== 'topic') {
                const target = state.outline[tab.from];
                return {
                  key: tab.kind,
                  label: t.record.moreTab(tab.count),
                  a11y:
                    tab.kind === 'before'
                      ? t.record.a11yMoreBefore(tab.count)
                      : t.record.a11yMoreAfter(tab.count),
                  state: tab.kind === 'before' ? 'done' : 'next',
                  onPress: () => openOverview(target?.id ?? null),
                };
              }
              const item = state.outline[tab.index]!;
              const tabState =
                tab.index === currentIndex
                  ? 'now'
                  : currentIndex !== null && tab.index < currentIndex
                    ? 'done'
                    : 'next';
              return {
                key: item.id,
                label: String(tab.index + 1),
                a11y: t.record.a11yTab(
                  tab.index + 1,
                  item.heading,
                  tabState === 'now'
                    ? t.record.talkingNow
                    : tabState === 'done'
                      ? t.record.a11yTalked
                      : t.record.a11yUpcoming,
                ),
                state: tabState,
                onPress: () => openOverview(item.id),
              };
            })}
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
                  // 画面の通知は出さない（ページがめくれるので見て分かる）。読み上げにだけ伝える
                  .then(
                    (it) =>
                      it &&
                      AccessibilityInfo.announceForAccessibility(t.record.a11yAdvanced(it.heading)),
                  )
              }
            />
          ) : null}
        </View>
      )}

      <Sheet
        visible={open}
        onClose={() => {
          setOpen(false);
          setFocus(null);
        }}
        title={t.record.topicsTitle}
        scrollTo={scrollTo}
      >
        <ReorderList
          items={state.outline}
          keyOf={(item) => item.id}
          labelOf={(item) => item.heading}
          onMove={(from, to) => ws.saveOutline(moveItem(state.outline, from, to))}
          onPick={pick}
          onCross={cross}
          renderItem={(item, i, { grip, a11y }) => (
            <View
              onLayout={(e) => {
                const h = e.nativeEvent.layout.height;
                setRowHeights((prev) => (prev[item.id] === h ? prev : { ...prev, [item.id]: h }));
              }}
              style={{
                backgroundColor:
                  item.id === focus
                    ? c.mistakeSubtle
                    : item.id === current?.id
                      ? c.accentSubtle
                      : 'transparent',
              }}
            >
              <Row
                mono={String(i + 1).padStart(2, '0')}
                label={item.heading}
                sub={`${cueOf(item.id) ? `${cueOf(item.id)} · ` : ''}${item.body.trim() ? item.body.trim() : t.record.addScript}`}
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
            </View>
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
  nextTopic: { marginTop: space.md },
  rowActions: { flexDirection: 'row', alignItems: 'center', marginRight: -space.md },
});
