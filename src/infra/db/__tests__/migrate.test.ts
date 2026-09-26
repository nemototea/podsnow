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
      'recording_events',
      'outline_items',
      'show_topic_template',
      'edit_ops',
      'exports',
      'transcripts',
      'recovery_journal',
      'app_settings',
      'show_categories',
      'show_funding',
      'show_external_ids',
      'feed_episodes',
    ]) {
      expect(names).toContain(t);
    }
    // 0003 で置き換えたテーブルは残っていない（二重の真実を作らない）。
    expect(names).not.toContain('markers');
    expect(names).not.toContain('topics');
  });

  it('0002 adds audio_purged_at to an existing v1 database without touching rows', async () => {
    const db = createNodeSqliteExecutor();
    // まず v1 まで進め、データを入れてから 0002 を当てる（前進のテスト）。
    await migrate(db, [MIGRATIONS[0]!]);
    const now = Date.now();
    await db.run('INSERT INTO shows (id, created_at, updated_at) VALUES (?, ?, ?)', [
      's1',
      now,
      now,
    ]);
    await db.run(
      'INSERT INTO episodes (id, show_id, episode_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['e1', 's1', 7, now, now],
    );

    const r = await migrate(db);
    expect(r.applied).toEqual(MIGRATIONS.slice(1).map((m) => m.name));

    const ep = await db.get<{ episode_number: number; audio_purged_at: number | null }>(
      'SELECT episode_number, audio_purged_at FROM episodes WHERE id = ?',
      ['e1'],
    );
    expect(ep).toEqual({ episode_number: 7, audio_purged_at: null });
  });

  it('0003 moves topics into outline_items and keeps only system markers', async () => {
    const db = createNodeSqliteExecutor();
    await migrate(db, [MIGRATIONS[0]!, MIGRATIONS[1]!]);
    const now = Date.now();
    await db.run('INSERT INTO shows (id, created_at, updated_at) VALUES (?,?,?)', ['s1', now, now]);
    await db.run(
      'INSERT INTO episodes (id, show_id, episode_number, created_at, updated_at) VALUES (?,?,?,?,?)',
      ['e1', 's1', 1, now, now],
    );
    await db.run(
      'INSERT INTO takes (id, episode_id, status, started_at, created_at, updated_at) VALUES (?,?,?,?,?,?)',
      ['t1', 'e1', 'ready', now, now, now],
    );
    await db.run(
      'INSERT INTO topics (id, episode_id, position, text, checked_at, checked_take_id, checked_src_smp) VALUES (?,?,?,?,?,?,?)',
      ['tp1', 'e1', 0, '近況', now, 't1', 4800],
    );
    await db.run('INSERT INTO topics (id, episode_id, position, text) VALUES (?,?,?,?)', [
      'tp2',
      'e1',
      1,
      'お便り',
    ]);
    const markers: [string, string][] = [
      ['m1', 'mistake'],
      ['m2', 'edit_point'],
      ['m3', 'interruption'],
      ['m4', 'topic'],
      ['m5', 'route_change'],
    ];
    for (const [id, kind] of markers) {
      await db.run(
        'INSERT INTO markers (id, episode_id, take_id, src_smp, label, kind, created_at) VALUES (?,?,?,?,?,?,?)',
        [id, 'e1', 't1', 100, id, kind, now],
      );
    }

    expect((await migrate(db)).applied).toEqual(MIGRATIONS.slice(2).map((m) => m.name));

    // トークテーマは見出しとして残り、チェック位置はチャプターになる
    expect(
      await db.all(
        'SELECT heading, body, recorded_take_id, recorded_src_smp, done_at FROM outline_items WHERE episode_id = ? ORDER BY position',
        ['e1'],
      ),
    ).toEqual([
      { heading: '近況', body: '', recorded_take_id: 't1', recorded_src_smp: 4800, done_at: now },
      {
        heading: 'お便り',
        body: '',
        recorded_take_id: null,
        recorded_src_smp: null,
        done_at: null,
      },
    ]);
    // 残すのはアプリが記録したものだけ。ユーザーが打ったマーカーは捨てる（FR-REC-4 廃止）
    expect(
      await db.all('SELECT kind FROM recording_events WHERE episode_id = ? ORDER BY id', ['e1']),
    ).toEqual([{ kind: 'interruption' }, { kind: 'route_change' }]);
  });

  it('0004 adds episodes.export_preset (NULL for existing rows) and drops shows.default_export_preset', async () => {
    const db = createNodeSqliteExecutor();
    await migrate(db, MIGRATIONS.slice(0, 3));
    const now = Date.now();
    await db.run(
      'INSERT INTO shows (id, name, default_export_preset, created_at, updated_at) VALUES (?,?,?,?,?)',
      ['s1', '番組', '{"bitrate":128000}', now, now],
    );
    await db.run(
      'INSERT INTO episodes (id, show_id, title, episode_number, created_at, updated_at) VALUES (?,?,?,?,?,?)',
      ['e1', 's1', '第1回', 3, now, now],
    );

    expect((await migrate(db, MIGRATIONS.slice(0, 4))).applied).toEqual([
      '0004_episode_export_preset',
    ]);

    // 既存の回は「選んだことがない」= 設定の既定で開く
    expect(
      await db.get('SELECT title, episode_number, export_preset FROM episodes WHERE id = ?', [
        'e1',
      ]),
    ).toEqual({ title: '第1回', episode_number: 3, export_preset: null });
    // 番組の行は残り、使われていなかった列だけが消える
    const showCols = (await db.all<{ name: string }>('PRAGMA table_info(shows)')).map(
      (c) => c.name,
    );
    expect(showCols).not.toContain('default_export_preset');
    expect(await db.get('SELECT name FROM shows WHERE id = ?', ['s1'])).toEqual({ name: '番組' });

    // 列はプリセットのキーだけを受け付ける
    await db.run('UPDATE episodes SET export_preset = ? WHERE id = ?', ['wav', 'e1']);
    await expect(
      db.run('UPDATE episodes SET export_preset = ? WHERE id = ?', ['mp3', 'e1']),
    ).rejects.toThrow();
    expect(await db.get('SELECT export_preset FROM episodes WHERE id = ?', ['e1'])).toEqual({
      export_preset: 'wav',
    });
  });

  it('0005 adds podcast RSS fields with defaults and gives existing episodes a stable guid', async () => {
    const db = createNodeSqliteExecutor();
    await migrate(db, MIGRATIONS.slice(0, 4));
    const now = Date.now();
    await db.run('INSERT INTO shows (id, name, created_at, updated_at) VALUES (?,?,?,?)', [
      's1',
      '番組',
      now,
      now,
    ]);
    await db.run(
      'INSERT INTO episodes (id, show_id, episode_number, created_at, updated_at) VALUES (?,?,?,?,?)',
      ['e1', 's1', 3, now, now],
    );

    expect((await migrate(db)).applied).toEqual(['0005_podcast_feed_metadata']);

    expect(
      await db.get(
        'SELECT name, website_url, language, explicit, show_type, copyright, owner_name, owner_email, complete, locked, feed_url, podcast_guid, cover_source_url, feed_imported_at FROM shows WHERE id = ?',
        ['s1'],
      ),
    ).toEqual({
      name: '番組',
      website_url: '',
      language: '',
      explicit: 0,
      show_type: 'episodic',
      copyright: '',
      owner_name: '',
      owner_email: '',
      complete: 0,
      locked: 0,
      feed_url: null,
      podcast_guid: null,
      cover_source_url: null,
      feed_imported_at: null,
    });
    expect(
      await db.get(
        'SELECT guid, episode_type, explicit, website_url, published_at FROM episodes WHERE id = ?',
        ['e1'],
      ),
    ).toEqual({
      guid: 'e1',
      episode_type: 'full',
      explicit: null,
      website_url: '',
      published_at: null,
    });
  });

  it('0005 constrains podcast enumerations and feed guids', async () => {
    const db = createNodeSqliteExecutor();
    await migrate(db);
    const now = Date.now();
    await db.run('INSERT INTO shows (id, created_at, updated_at) VALUES (?,?,?)', ['s1', now, now]);
    await expect(db.run("UPDATE shows SET show_type = 'weekly' WHERE id = 's1'")).rejects.toThrow();
    await expect(db.run("UPDATE shows SET explicit = 2 WHERE id = 's1'")).rejects.toThrow();
    await db.run(
      'INSERT INTO episodes (id, show_id, episode_number, created_at, updated_at) VALUES (?,?,?,?,?)',
      ['e1', 's1', 1, now, now],
    );
    await expect(
      db.run("UPDATE episodes SET episode_type = 'teaser' WHERE id = 'e1'"),
    ).rejects.toThrow();
    await expect(
      db.run(
        'INSERT INTO show_external_ids (show_id, provider, external_id, updated_at) VALUES (?,?,?,?)',
        ['s1', 'spotify', 'x', now],
      ),
    ).rejects.toThrow();
    const insertFeed = (id: string) =>
      db.run(
        'INSERT INTO feed_episodes (id, show_id, guid, created_at, updated_at) VALUES (?,?,?,?,?)',
        [id, 's1', 'same-guid', now, now],
      );
    await insertFeed('f1');
    // 同じ番組に同じ guid の配信済みの回は 1 行だけ
    await expect(insertFeed('f2')).rejects.toThrow();
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
