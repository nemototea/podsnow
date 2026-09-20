import * as SQLite from 'expo-sqlite';

import type { SqlExecutor, SqlRow, SqlValue } from './executor';

/** expo-sqlite (SDK 57) の SQLiteDatabase を SqlExecutor に適合させる。 */
export function createExpoSqliteExecutor(db: SQLite.SQLiteDatabase): SqlExecutor {
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params = []) => {
      const r = await db.runAsync(sql, [...params]);
      return { changes: r.changes };
    },
    all: <T extends SqlRow>(sql: string, params: readonly SqlValue[] = []) =>
      db.getAllAsync<T>(sql, [...params]),
    get: async <T extends SqlRow>(sql: string, params: readonly SqlValue[] = []) =>
      (await db.getFirstAsync<T>(sql, [...params])) ?? null,
    transaction: async <T>(fn: () => Promise<T>) => {
      let result: T | undefined;
      await db.withExclusiveTransactionAsync(async () => {
        result = await fn();
      });
      return result as T;
    },
  };
}
