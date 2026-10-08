import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useT } from '@/i18n';
import { Button, Field } from '@/ui/components';
import { Sheet } from '@/ui/Sheet';
import { space } from '@/ui/tokens';

import type { Workspace } from './useWorkspace';

/**
 * カンペを書くシート（FR-OUT-2、Issue #180）。編集画面（収録タブの待機中）から開く。
 * 録音中は開かない（録音中は読むだけ）。閉じたとき（完了・✕・背景・下スワイプ）に変更があれば保存する。
 * iOS のページシートは下スワイプで閉じ終わってから知らされるので、閉じる前の確認は出せない（番組情報と同じ）。
 * 開く・閉じるは呼び出し側が持つ。
 */
export function NotesSheet({
  ws,
  open,
  onClose,
}: {
  ws: Workspace;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const saved = ws.state.notes;
  // 開いている間だけの下書き。開くたびに保存済みの文章から始める
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? saved;

  const close = () => {
    if (draft !== null && draft !== saved) void ws.saveNotes(draft);
    setDraft(null);
    onClose();
  };

  return (
    <Sheet visible={open} onClose={close} title={t.notes.title}>
      <Field
        label={t.notes.title}
        value={value}
        onChangeText={setDraft}
        placeholder={t.notes.placeholder}
        multiline
      />
      <View style={st.actions}>
        <Button label={t.common.done} accessibilityLabel={t.notes.a11ySave} onPress={close} />
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  actions: { gap: space.sm, marginTop: space.md },
});
