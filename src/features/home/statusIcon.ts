import type { HomeEpisodeItem } from '@/services/home/HomeService';
import type { IconName } from '@/ui/IconSvg';

/**
 * Home の一覧のエピソードの状態（FR-EP-3、DESIGN_SYSTEM.md §6.4）。Home のステッカーの文字・色・アイコンはこれで決める。
 *
 * 「書き出し済み」は今の編集と同じ音の書き出しがあるときだけ（Issue #168）。DB の `status` は
 * 書き出したあとに編集しても `exported` のままなので、そのときは声の有無で編集中に戻して見せる。
 */
export type EpisodeStatusKind = 'new' | 'draft' | 'ready' | 'exported' | 'published' | 'noAudio';

export function episodeStatusKind(item: HomeEpisodeItem): EpisodeStatusKind {
  const e = item.local;
  if (!e || item.feed) return 'published';
  if (e.audio_purged_at) return 'noAudio';
  if (e.take_count === 0) return 'new';
  if (item.hasCurrentExport) return 'exported';
  if (e.status !== 'exported') return e.status;
  return e.duration_smp > 0 ? 'ready' : 'draft';
}

/**
 * 状態のアイコン（Issue #171）。未録音を録音ボタン（mic / record）に、音声なしを音量に、
 * 書き出し済みと配信済みを同じ ✓ にしない。下書きと準備 OK はどちらも「編集中」で同じ形にする。
 */
export const STATUS_ICON = {
  new: 'statusNew',
  draft: 'statusEditing',
  ready: 'statusEditing',
  exported: 'export',
  published: 'published',
  noAudio: 'noAudio',
} as const satisfies Record<EpisodeStatusKind, IconName>;
