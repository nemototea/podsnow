import type { SqlExecutor } from './executor';
import { MIGRATIONS, type Migration } from './migrations';

export async function getUserVersion(db: SqlExecutor): Promise<number> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * user_version より新しい移行を順に適用する。
 * 各移行は 1 トランザクション。途中で失敗したら user_version は進まない。
 */
export async function migrate(
  db: SqlExecutor,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<{ from: number; to: number; applied: string[] }> {
  assertMonotonic(migrations);
  const from = await getUserVersion(db);
  const applied: string[] = [];
  let current = from;
  for (const m of migrations) {
    if (m.version <= current) continue;
    await db.transaction(async () => {
      await db.exec(m.sql);
      await db.exec(`PRAGMA user_version = ${m.version}`);
    });
    current = m.version;
    applied.push(m.name);
  }
  return { from, to: current, applied };
}

function assertMonotonic(migrations: readonly Migration[]): void {
  let prev = 0;
  for (const m of migrations) {
    if (m.version !== prev + 1) {
      throw new Error(
        `migrations must be consecutive: expected ${prev + 1}, got ${m.version} (${m.name})`,
      );
    }
    prev = m.version;
  }
}
