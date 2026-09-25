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
  clearHistory,
  loadHistory,
  persistCommit,
  persistCursorAndDoc,
  writeCommit,
} from '@/infra/db/repositories/editOpsRepo';

export interface EditingDeps {
  db: SqlExecutor;
  newId: () => string;
  now: () => number;
}

/**
 * エピソード 1 件の編集セッション。メモリ上の doc / history を持ち、
 * すべての変更を即座に SQLite に書く（FR-SAFE-8: 自動保存）。
 * 取り消しの履歴はエピソード画面を開いている間だけ効く。開くときと閉じるときに空にする
 * （FR-EDIT-7、Issue #122）。
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

  /** エピソード画面を開く。前回までの取り消しの履歴は捨てる。 */
  static async open(deps: EditingDeps, episodeId: string): Promise<EditingService> {
    await clearHistory(deps.db, episodeId, deps.now());
    return EditingService.resume(deps, episodeId);
  }

  /**
   * 開いている画面で DB から読み直す（録音の確定のあとなど）。履歴は捨てない。
   * RecordingSession は DB に直接書くので、メモリ上の doc を信用しない。
   */
  static async resume(deps: EditingDeps, episodeId: string): Promise<EditingService> {
    const [doc, history] = await Promise.all([
      loadDoc(deps.db, episodeId),
      loadHistory(deps.db, episodeId),
    ]);
    return new EditingService(deps, episodeId, doc, history ?? EMPTY_HISTORY);
  }

  /** エピソード画面を閉じる。取り消しの履歴を捨てる（doc はそのまま）。 */
  static discardHistory(deps: EditingDeps, episodeId: string): Promise<void> {
    return clearHistory(deps.db, episodeId, deps.now());
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

  /**
   * 履歴に残さない書き込み（録音中に重ねた素材）。録音を止めたときに、録音の追加と
   * まとめて 1 つの操作として履歴に積まれる（`commitInTransaction`）。
   */
  async writeWithoutHistory(mutate: (doc: EditableDoc) => EditableDoc): Promise<void> {
    const after = mutate(cloneDoc(this.doc));
    await this.deps.db.transaction(() =>
      saveDoc(this.deps.db, this.episodeId, after, this.deps.now()),
    );
    this.doc = after;
  }
}

/**
 * EditingService の外で起きた変更（録音の確定）を履歴に積む。Issue #122。
 * 呼び出し側のトランザクションの中で使う。`before` は変更前に DB から読んだ doc、
 * `after` は書き込む doc（この関数が保存する）。変更が無ければ doc だけ保存して null。
 */
export async function commitInTransaction(
  db: SqlExecutor,
  episodeId: string,
  before: EditableDoc,
  after: EditableDoc,
  o: Omit<CommitOptions, 'groupKey' | 'groupWindowMs'>,
): Promise<EditOp | null> {
  const history = await loadHistory(db, episodeId);
  const result = commit(history, before, after, o);
  if (!result.op) {
    await saveDoc(db, episodeId, after, o.now);
    return null;
  }
  await writeCommit(db, episodeId, result, after, o.now);
  return result.op;
}
