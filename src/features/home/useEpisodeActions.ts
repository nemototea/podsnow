import { useCallback } from 'react';

import { useServices } from '@/features/app/ServicesProvider';
import { errorText, useT } from '@/i18n';
import type { EpisodeListItem } from '@/infra/db/repositories/episodesRepo';
import { confirmDestructive } from '@/ui/alerts';
import type { MenuAction } from '@/ui/menuTypes';

/**
 * エピソードの「…」の項目（DESIGN_SYSTEM.md §8 E5）。Home と番組画面で同じ項目を出す。
 * 録音と書き出しのファイルもすぐ消えるので、削除の取り消しは出さない（Issue #152）。
 */
export function useEpisodeActions(
  reload: () => Promise<void>,
  notify: (text: string) => void,
): (e: EpisodeListItem) => MenuAction[] {
  const t = useT();
  const { episodes } = useServices();

  const run = useCallback(
    async (job: () => Promise<string>) => {
      try {
        notify(await job());
      } catch (err) {
        notify(errorText(t, err));
      }
      await reload();
    },
    [notify, reload, t],
  );

  return (e) => {
    const code = t.episode.number(e.episode_number);
    return [
      {
        key: 'duplicate',
        icon: 'copy',
        label: t.episode.menu.duplicate,
        onPress: () =>
          void run(async () => {
            const d = await episodes.duplicate(e.id);
            return t.episode.duplicated(t.episode.number(d.episode_number));
          }),
      },
      ...(e.audio_purged_at
        ? []
        : [
            {
              key: 'purge',
              icon: 'noAudio' as const,
              label: t.episode.menu.purgeAudio,
              onPress: () =>
                confirmDestructive({
                  title: t.episode.menu.purgeAudio,
                  message: t.episode.menu.purgeAudioSub,
                  confirmLabel: t.common.delete,
                  cancelLabel: t.common.cancel,
                  onConfirm: () =>
                    void run(async () => {
                      await episodes.purgeAudio(e.id);
                      return t.home.audioPurged(code);
                    }),
                }),
            },
          ]),
      {
        key: 'remove',
        icon: 'trash',
        label: t.episode.menu.remove,
        destructive: true,
        onPress: () =>
          confirmDestructive({
            title: t.episode.menu.remove,
            message: t.episode.menu.removeMessage,
            confirmLabel: t.common.delete,
            cancelLabel: t.common.cancel,
            onConfirm: () =>
              void run(async () => {
                await episodes.remove(e.id);
                return t.home.removed(code);
              }),
          }),
      },
    ];
  };
}
