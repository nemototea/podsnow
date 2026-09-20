// テスト専用: Node 組み込みの node:sqlite で SqlExecutor を実装する。
// expo-sqlite はネイティブなので Jest(node) では動かない。DDL は両者で共通の SQLite。
import { DatabaseSync } from 'node:sqlite';

import type { SqlExecutor, SqlRow, SqlValue } from '../executor';

export function createNodeSqliteExecutor(path = ':memory:'): SqlExecutor & { raw: DatabaseSync } {
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON;');
  let depth = 0;
  return {
    raw,
    exec: async (sql) => {
      raw.exec(sql);
    },
    run: async (sql, params = []) => {
      const r = raw.prepare(sql).run(...(params as SqlValue[]));
      return { changes: Number(r.changes) };
    },
    all: async <T extends SqlRow>(sql: string, params: readonly SqlValue[] = []) =>
      raw.prepare(sql).all(...(params as SqlValue[])) as unknown as T[],
    get: async <T extends SqlRow>(sql: string, params: readonly SqlValue[] = []) =>
      (raw.prepare(sql).get(...(params as SqlValue[])) as unknown as T | undefined) ?? null,
    transaction: async (fn) => {
      if (depth > 0) return fn();
      depth++;
      raw.exec('BEGIN');
      try {
        const v = await fn();
        raw.exec('COMMIT');
        return v;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
  };
}
