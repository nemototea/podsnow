/**
 * DB 実装（expo-sqlite / node:sqlite）を抽象化する最小インターフェース。
 * 移行ロジックと repository はこれだけに依存し、Jest では node:sqlite で検証する。
 */
export type SqlValue = string | number | null | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

export interface SqlExecutor {
  /** 複数文の実行（DDL 用）。 */
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<{ changes: number }>;
  all<T extends SqlRow = SqlRow>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  get<T extends SqlRow = SqlRow>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
  /** 排他トランザクション。fn が throw したらロールバック。 */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
