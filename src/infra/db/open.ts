import * as SQLite from 'expo-sqlite';

import type { SqlExecutor } from './executor';
import { createExpoSqliteExecutor } from './expoSqliteExecutor';
import { migrate } from './migrate';

export const DB_NAME = 'podsnow.db';

let opened: Promise<SqlExecutor> | null = null;

/**
 * アプリの DB を開き、WAL と外部キーを有効化し、移行を適用する。
 * 二重に呼ばれても 1 回しか開かない。
 */
export function openAppDatabase(): Promise<SqlExecutor> {
  if (!opened) {
    opened = (async () => {
      const raw = await SQLite.openDatabaseAsync(DB_NAME);
      await raw.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      const db = createExpoSqliteExecutor(raw);
      await migrate(db);
      return db;
    })();
    opened.catch(() => {
      opened = null;
    });
  }
  return opened;
}
