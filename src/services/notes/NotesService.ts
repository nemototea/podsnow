import type { SqlExecutor } from '@/infra/db/executor';
import {
  getEpisodeNotes,
  getShowNotesTemplate,
  setEpisodeNotes,
  setShowNotesTemplate,
} from '@/infra/db/repositories/notesRepo';

/**
 * カンペとカンペのひな形（REQUIREMENTS.md §2.2.1 FR-OUT-1..3、FR-SHOW-4、Issue #180）。
 *
 * カンペはエピソードごとに 1 枚の自由なテキスト。項目・並び順・録音位置を持たない。
 * Undo の対象にしない。テキスト入力を取り消しの履歴に混ぜると、録音の取り消しと同じ操作で
 * 文字が戻ることになるため（入力欄の取り消しは OS に任せる）。
 * 新しいエピソードへのひな形の写しは `EpisodeService.create` が同じトランザクションで行う。
 */
export class NotesService {
  constructor(private readonly deps: { db: SqlExecutor }) {}

  get(episodeId: string): Promise<string> {
    return getEpisodeNotes(this.deps.db, episodeId);
  }

  save(episodeId: string, notes: string): Promise<void> {
    return setEpisodeNotes(this.deps.db, episodeId, notes);
  }

  getTemplate(showId: string): Promise<string> {
    return getShowNotesTemplate(this.deps.db, showId);
  }

  saveTemplate(showId: string, text: string): Promise<void> {
    return setShowNotesTemplate(this.deps.db, showId, text);
  }
}
