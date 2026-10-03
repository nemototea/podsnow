import type { HomeEpisodeItem } from '@/services/home/HomeService';
import type { IconName } from '@/ui/IconSvg';

/**
 * Home の一覧のエピソードの状態（FR-EP-3、DESIGN_SYSTEM.md §6.4）。
 * 判定の順は Home のステッカー（`src/app/index.tsx` の `statusText`）と同じ。
 */
export type EpisodeStatusKind = 'new' | 'draft' | 'ready' | 'exported' | 'published' | 'noAudio';

export function episodeStatusKind(item: HomeEpisodeItem): EpisodeStatusKind {
  const e = item.local;
  if (!e || item.feed) return 'published';
  if (e.audio_purged_at) return 'noAudio';
  if (e.take_count === 0) return 'new';
  return e.status;
}

/**
 * 状態のアイコン（Issue #171）。未録音を録音ボタン（mic / record）に、音声なしを音量に、
 * 書き出し済みと配信済みを同じ ✓ にしない。下書きと準備 OK はどちらも「編集中」で同じ形にする。
 * 一覧の行への組み込みは #168 で行う。
 */
export const STATUS_ICON = {
  new: 'statusNew',
  draft: 'statusEditing',
  ready: 'statusEditing',
  exported: 'export',
  published: 'published',
  noAudio: 'noAudio',
} as const satisfies Record<EpisodeStatusKind, IconName>;
