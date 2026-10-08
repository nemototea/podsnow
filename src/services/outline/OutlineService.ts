import {
  moveItem,
  newItem,
  nextIndex,
  splitIntoHeadings,
  type OutlineItem,
} from '@/domain/outline';
import type { Smp } from '@/domain/time';
import type { SqlExecutor } from '@/infra/db/executor';
import {
  listOutline,
  listShowTopicTemplate,
  markRecordedAt,
  saveOutline,
  saveShowTopicTemplate,
} from '@/infra/db/repositories/outlineRepo';

export interface OutlineDeps {
  db: SqlExecutor;
  newId: () => string;
  now: () => number;
}

/**
 * トークテーマと台本（FR-OUT-1..5）。
 *
 * Undo の対象にしない。理由は 2 つ:
 *   - テキスト入力を Undo 履歴に混ぜると、録音の取り消しと同じ操作で文字が戻ることになる
 *   - 項目を消すときは、削除前の確認で守る（FR-UI-2）。取り消しで守るのは音源の操作（Issue #122）
 * チャプターの位置は (take_id, src_smp) に紐づくので、声を切っても自動で追従する
 * （`domain/timeline/voice.ts:resolveTimeline`）。Undo で位置を戻す必要はない。
 */
export class OutlineService {
  constructor(private readonly deps: OutlineDeps) {}

  list(episodeId: string): Promise<OutlineItem[]> {
    return listOutline(this.deps.db, episodeId);
  }

  /** 並びをまるごと保存する（並べ替え・削除・本文の編集の共通ルート）。 */
  async save(episodeId: string, items: readonly OutlineItem[]): Promise<void> {
    await this.deps.db.transaction(() => saveOutline(this.deps.db, episodeId, items));
  }

  /**
   * 複数行のテキストを末尾に足す（FR-OUT-3）。1 行 = 1 項目。
   * 戻り値は追加後の全項目。
   */
  async addFromText(episodeId: string, text: string): Promise<OutlineItem[]> {
    const added = splitIntoHeadings(text).map((h) => newItem(this.deps.newId(), h));
    if (!added.length) return this.list(episodeId);
    const next = [...(await this.list(episodeId)), ...added];
    await this.save(episodeId, next);
    return next;
  }

  async update(
    episodeId: string,
    itemId: string,
    patch: Partial<Pick<OutlineItem, 'heading' | 'body'>>,
  ): Promise<OutlineItem[]> {
    const next = (await this.list(episodeId)).map((i) =>
      i.id === itemId ? { ...i, ...patch } : i,
    );
    await this.save(episodeId, next);
    return next;
  }

  async remove(episodeId: string, itemId: string): Promise<OutlineItem[]> {
    const next = (await this.list(episodeId)).filter((i) => i.id !== itemId);
    await this.save(episodeId, next);
    return next;
  }

  async move(episodeId: string, from: number, to: number): Promise<OutlineItem[]> {
    const next = moveItem(await this.list(episodeId), from, to);
    await this.save(episodeId, next);
    return next;
  }

  /**
   * 次の項目へ進む（FR-OUT-4）。録音中なら現在位置をチャプターとして記録する。
   * 録音していないときは位置を持たないので、話し終えた印だけを付ける。
   * 戻り値は進んだ先の項目（もう無ければ null）。
   */
  async advance(
    episodeId: string,
    at: { takeId: string; srcSmp: Smp } | null,
  ): Promise<OutlineItem | null> {
    const items = await this.list(episodeId);
    const i = nextIndex(items);
    if (i === null) return null;
    const target = items[i]!;
    await markRecordedAt(this.deps.db, target.id, at, this.deps.now());
    return { ...target, recordedTakeId: at?.takeId ?? null, recordedSrcSmp: at?.srcSmp ?? null };
  }

  /** 指定の項目へ直接跳ぶ（スワイプで戻ったとき）。 */
  async markAt(itemId: string, at: { takeId: string; srcSmp: Smp } | null): Promise<void> {
    await markRecordedAt(this.deps.db, itemId, at, at ? this.deps.now() : null);
  }

  // ---- 番組のひな形（FR-SHOW-4）----

  listTemplate(showId: string): Promise<{ heading: string; body: string }[]> {
    return listShowTopicTemplate(this.deps.db, showId);
  }

  async saveTemplate(
    showId: string,
    items: readonly { heading: string; body: string }[],
  ): Promise<void> {
    await this.deps.db.transaction(() =>
      saveShowTopicTemplate(this.deps.db, showId, this.deps.newId, items),
    );
  }

  /** ひな形を新規エピソードへ写す。写した後はエピソードのデータなので、ひな形の変更は追わない。 */
  async applyTemplate(showId: string, episodeId: string): Promise<void> {
    const template = await this.listTemplate(showId);
    if (!template.length) return;
    await this.save(
      episodeId,
      template.map((t) => newItem(this.deps.newId(), t.heading, t.body)),
    );
  }
}
