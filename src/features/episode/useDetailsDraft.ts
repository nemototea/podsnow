import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useServices } from '@/features/app/ServicesProvider';

import {
  applyDetailsPatch,
  detailsPatch,
  draftFromEpisode,
  type DetailsDraft,
} from './detailsDraft';
import type { Workspace } from './useWorkspace';

type Saved = Parameters<typeof detailsPatch>[1] & { id: string };

/**
 * 書き出しタブの「エピソードの詳細」の入力中の値と自動保存（Issue #167）。
 *
 * エピソード画面で持つ（タブの中で持つと、タブを切り替えたときに入力中の値が破棄され、
 * 戻ったときに読み直していない `ws.state.episode` から作り直されて消えて見える）。
 * 画面を離れるときの保存は画面側が `flushNow()` を呼ぶ。「空の回を捨てる」より先に保存するため
 * （Issue #168。保存前に判定すると、タイトルだけ入れた回が捨てられる）。
 */
export function useDetailsDraft(ws: Workspace, onError: (e: unknown) => void) {
  const { episodes } = useServices();
  const episode = ws.state.episode;
  const [draft, setDraft] = useState<DetailsDraft | null>(null);
  // 入力中の値は ref にも持ち、離れる瞬間の保存でも最新の値を書く
  const draftRef = useRef<DetailsDraft | null>(null);
  const savedRef = useRef<Saved | null>(null);
  const onErrorRef = useRef(onError);
  const reloadRef = useRef(ws.reloadAll);
  useEffect(() => {
    onErrorRef.current = onError;
    reloadRef.current = ws.reloadAll;
  });

  const hydrated = draft !== null;
  useEffect(() => {
    if (!episode || hydrated) return;
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive) return;
      const next = draftFromEpisode(episode);
      draftRef.current = next;
      savedRef.current = {
        id: episode.id,
        title: episode.title,
        description: episode.description,
        episode_number: episode.episode_number,
        season: episode.season,
        recorded_at: episode.recorded_at,
      };
      setDraft(next);
    });
    return () => {
      alive = false;
    };
  }, [episode, hydrated]);

  /** 変わった項目だけを保存する。何も変わっていなければ何もしない。`reload` で画面の値も読み直す。 */
  const save = useCallback(
    async (reload: boolean) => {
      const d = draftRef.current;
      const saved = savedRef.current;
      if (!d || !saved) return;
      const patch = detailsPatch(d, saved);
      if (!patch) return;
      savedRef.current = applyDetailsPatch(saved, patch);
      try {
        await episodes.update(saved.id, patch);
      } catch (e) {
        savedRef.current = saved;
        onErrorRef.current(e);
        return;
      }
      if (reload) await reloadRef.current();
    },
    [episodes],
  );
  /** 入力をやめたとき（blur・タブ切替）。保存して画面の値も読み直す。 */
  const flush = useCallback(() => save(true), [save]);
  /** 画面を離れるとき・アプリを裏へ回したとき。読み直さない（画面はもう無いか、見えていない）。 */
  const flushNow = useCallback(() => save(false), [save]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') void flushNow();
    });
    return () => sub.remove();
  }, [flushNow]);

  const edit = useCallback((patch: Partial<DetailsDraft>) => {
    if (!draftRef.current) return;
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
  }, []);

  return { draft, draftRef, edit, flush, flushNow };
}

export type DetailsDraftState = ReturnType<typeof useDetailsDraft>;
