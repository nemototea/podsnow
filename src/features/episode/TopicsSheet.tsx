import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { moveItem } from '@/domain/outline';
import { formatClock } from '@/domain/time';
import { useT } from '@/i18n';
import { space } from '@/ui/tokens';
import { Button, Field, IconButton, Row } from '@/ui/components';
import { Sheet } from '@/ui/Sheet';
import { confirmDestructive } from '@/ui/alerts';
import { ReorderList } from '@/ui/ReorderList';
import { useAppTheme } from '@/ui/ThemeContext';

import { useServices } from '../app/ServicesProvider';
import type { Workspace } from './useWorkspace';

/**
 * トークテーマと台本の一覧のシート（FR-REC-6）。録音前・録音中・録音後のいつでも開ける。
 * 並べ替え・削除・追加と、項目ごとの台本の編集を行う。開く・閉じるは呼び出し側が持つ。
 */
export function TopicsSheet({
  ws,
  open,
  focus,
  onClose,
}: {
  ws: Workspace;
  open: boolean;
  /** 開いたときに示す項目（収録画面のカードやチャプターの行から開いたとき）。 */
  focus: string | null;
  onClose: () => void;
}) {
  const c = useAppTheme();
  const t = useT();
  const { state } = ws;
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [body, setBody] = useState('');
  // 全体のシートの行の高さ。押した話題の上端（= それより前の行の高さの和）まで送るのに使う
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const focusIndex = focus === null ? -1 : state.outline.findIndex((i) => i.id === focus);
  const before = focusIndex < 0 ? [] : state.outline.slice(0, focusIndex);
  const scrollTo =
    focusIndex < 0 || before.some((i) => rowHeights[i.id] === undefined)
      ? null
      : before.reduce((y, i) => y + rowHeights[i.id]!, 0);

  const currentIndex = ws.outlineCurrent;
  const current = currentIndex === null ? null : (state.outline[currentIndex] ?? null);
  const cueAt = new Map(ws.chaptersOnTimeline.map((ch) => [ch.item.id, ch.at] as const));
  const cueOf = (id: string): string | null => {
    const at = cueAt.get(id);
    return at === undefined ? null : formatClock(at);
  };

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
    <>
      <Sheet visible={open} onClose={onClose} title={t.record.topicsTitle} scrollTo={scrollTo}>
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
    </>
  );
}

const st = StyleSheet.create({
  rowActions: { flexDirection: 'row', alignItems: 'center', marginRight: -space.md },
});
