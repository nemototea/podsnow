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
      await migrate(db, undefined, {
        // 移行前の DB を同じ場所に丸ごと写す（DATA_MODEL.md §7。0010 はデータを捨てる移行なので必須）。
        // 同じ版からの移行をやり直したときは上書きする。
        beforeMigrate: async (from) => {
          const dest = await SQLite.openDatabaseAsync(`${DB_NAME}.bak-${from}`);
          try {
            await SQLite.backupDatabaseAsync({ sourceDatabase: raw, destDatabase: dest });
          } finally {
            await dest.closeAsync();
          }
        },
      });
      return db;
    })();
    opened.catch(() => {
      opened = null;
    });
  }
  return opened;
}
