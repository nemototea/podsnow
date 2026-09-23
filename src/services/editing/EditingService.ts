import { cloneDoc, type EditableDoc } from '@/domain/editing/doc';
import {
  commit,
  EMPTY_HISTORY,
  redo,
  undo,
  type CommitOptions,
  type EditOp,
  type History,
} from '@/domain/editing/history';
import type { SqlExecutor } from '@/infra/db/executor';
import { loadDoc, saveDoc } from '@/infra/db/repositories/editableDocRepo';
import {
  loadHistory,
  persistCommit,
  persistCursorAndDoc,
} from '@/infra/db/repositories/editOpsRepo';

export interface EditingDeps {
  db: SqlExecutor;
  newId: () => string;
  now: () => number;
}

/**
 * エピソード 1 件の編集セッション。メモリ上の doc / history を持ち、
 * すべての変更を即座に SQLite に書く（FR-SAFE-8: 自動保存、Undo は再起動後も有効）。
 */
export class EditingService {
  private doc: EditableDoc;
  private history: History;

  private constructor(
    private readonly deps: EditingDeps,
    readonly episodeId: string,
    doc: EditableDoc,
    history: History,
  ) {
    this.doc = doc;
    this.history = history;
  }

  static async open(deps: EditingDeps, episodeId: string): Promise<EditingService> {
    const [doc, history] = await Promise.all([
      loadDoc(deps.db, episodeId),
      loadHistory(deps.db, episodeId),
    ]);
    return new EditingService(deps, episodeId, doc, history ?? EMPTY_HISTORY);
  }

  get current(): EditableDoc {
    return this.doc;
  }
  get canUndo(): boolean {
    return this.history.cursor > 0;
  }
  get canRedo(): boolean {
    return this.history.cursor < this.history.ops.length;
  }
  get undoLabel(): string | null {
    return this.canUndo ? this.history.ops[this.history.cursor - 1]!.label : null;
  }
  get undoTopId(): string | null {
    return this.canUndo ? this.history.ops[this.history.cursor - 1]!.id : null;
  }
  get redoLabel(): string | null {
    return this.canRedo ? this.history.ops[this.history.cursor]!.label : null;
  }

  /**
   * 編集を適用して永続化する。mutate は新しい doc を返す純粋関数。
   * 戻り値は追加された op（変更なしなら null）。
   */
  async apply(
    label: string,
    mutate: (doc: EditableDoc) => EditableDoc,
    opts: { groupKey?: string | null } = {},
  ): Promise<EditOp | null> {
    const before = this.doc;
    const after = mutate(cloneDoc(before));
    const o: CommitOptions = {
      id: this.deps.newId(),
      label,
      now: this.deps.now(),
      groupKey: opts.groupKey ?? null,
    };
    const result = commit(this.history, before, after, o);
    if (!result.op) return null;
    await persistCommit(this.deps.db, this.episodeId, result, after, o.now);
    this.history = result.history;
    this.doc = after;
    return result.op;
  }

  async undo(): Promise<EditOp | null> {
    const r = undo(this.history);
    if (!r) return null;
    await persistCursorAndDoc(this.deps.db, this.episodeId, r.history, r.doc, this.deps.now());
    this.history = r.history;
    this.doc = r.doc;
    return r.op;
  }

  async redo(): Promise<EditOp | null> {
    const r = redo(this.history);
    if (!r) return null;
    await persistCursorAndDoc(this.deps.db, this.episodeId, r.history, r.doc, this.deps.now());
    this.history = r.history;
    this.doc = r.doc;
    return r.op;
  }

  /** 履歴に残さない書き込み（録音停止時の Take 追加など、Undo 対象外の変更）。 */
  async writeWithoutHistory(mutate: (doc: EditableDoc) => EditableDoc): Promise<void> {
    const after = mutate(cloneDoc(this.doc));
    await this.deps.db.transaction(() =>
      saveDoc(this.deps.db, this.episodeId, after, this.deps.now()),
    );
    this.doc = after;
  }
}
