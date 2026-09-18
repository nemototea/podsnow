import { migrate, getUserVersion } from '../migrate';
import { MIGRATIONS } from '../migrations';
import { createNodeSqliteExecutor } from './nodeSqliteExecutor';

describe('migrate', () => {
  it('applies all migrations to a fresh database and sets user_version', async () => {
    const db = createNodeSqliteExecutor();
    const r = await migrate(db);
    expect(r.from).toBe(0);
    expect(r.to).toBe(MIGRATIONS.length);
    expect(r.applied).toEqual(MIGRATIONS.map((m) => m.name));
    expect(await getUserVersion(db)).toBe(MIGRATIONS.length);
  });

  it('is idempotent: running twice applies nothing the second time', async () => {
    const db = createNodeSqliteExecutor();
    await migrate(db);
    const r = await migrate(db);
    expect(r.applied).toEqual([]);
    expect(r.from).toBe(MIGRATIONS.length);
  });

  it('creates every table from DATA_MODEL.md §4', async () => {
    const db = createNodeSqliteExecutor();
    await migrate(db);
    const rows = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const names = rows.map((r) => r.name);
    for (const t of [
      'shows',
      'show_layout',
      'description_templates',
      'assets',
      'episodes',
      'takes',
      'take_segments',
      'voice_segments',
      'overlay_clips',
      'markers',
      'topics',
      'edit_ops',
      'exports',
      'transcripts',
      'recovery_journal',
      'app_settings',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('rolls back a failing migration without advancing user_version', async () => {
    const db = createNodeSqliteExecutor();
    await migrate(db);
    await expect(
      migrate(db, [
        ...MIGRATIONS,
        {
          version: MIGRATIONS.length + 1,
          name: 'bad',
          sql: 'CREATE TABLE ok_before_failure (a); THIS IS NOT SQL;',
        },
      ]),
    ).rejects.toThrow();
    expect(await getUserVersion(db)).toBe(MIGRATIONS.length);
    const t = await db.get("SELECT name FROM sqlite_master WHERE name='ok_before_failure'");
    expect(t).toBeNull();
  });

  it('rejects non-consecutive migration versions', async () => {
    const db = createNodeSqliteExecutor();
    await expect(migrate(db, [{ version: 2, name: 'skip', sql: '' }])).rejects.toThrow(
      /consecutive/,
    );
  });

  it('enforces the CHECK constraints and foreign keys of the schema', async () => {
    const db = createNodeSqliteExecutor();
    await migrate(db);
    const now = Date.now();
    await db.run('INSERT INTO shows (id, created_at, updated_at) VALUES (?, ?, ?)', [
      's1',
      now,
      now,
    ]);
    await db.run(
      'INSERT INTO episodes (id, show_id, episode_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['e1', 's1', 1, now, now],
    );
    // 存在しない show への episode は FK 違反
    await expect(
      db.run(
        'INSERT INTO episodes (id, show_id, episode_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ['e2', 'nope', 2, now, now],
      ),
    ).rejects.toThrow();
    // takes.status は列挙のみ
    await expect(
      db.run(
        'INSERT INTO takes (id, episode_id, status, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['t1', 'e1', 'weird', now, now, now],
      ),
    ).rejects.toThrow();
    // voice_segments は src_end > src_start
    await db.run(
      'INSERT INTO takes (id, episode_id, status, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['t1', 'e1', 'ready', now, now, now],
    );
    await expect(
      db.run(
        'INSERT INTO voice_segments (id, episode_id, position, take_id, src_start_smp, src_end_smp, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['v1', 'e1', 0, 't1', 100, 100, now],
      ),
    ).rejects.toThrow();
  });
});
