import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { moveItem } from '@/domain/outline';
import { useT } from '@/i18n';
import { icon, radius, space, stroke, tabularNums, typography } from '@/ui/tokens';
import { Button, Field, Icon, IconButton, Row, SectionHeader, Sheet, Text } from '@/ui/components';
import { confirmDestructive } from '@/ui/alerts';
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

  const current = ws.outlineCurrent === null ? null : (state.outline[ws.outlineCurrent] ?? null);
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
  rowActions: { flexDirection: 'row', alignItems: 'center', marginRight: -space.md },
});
