import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';
import { loadDoc, saveDoc } from '@/infra/db/repositories/editableDocRepo';
import { getEpisode } from '@/infra/db/repositories/episodesRepo';
import {
  listOutline,
  saveOutline,
  saveShowTopicTemplate,
} from '@/infra/db/repositories/outlineRepo';
import { ensureDefaultShow, updateLayout } from '@/infra/db/repositories/showsRepo';
import { TEST_LABELS, TEST_SHOW_SEED } from '@/services/app/__tests__/labels';

import { EpisodeService } from '../EpisodeService';

async function setup() {
  const db = createNodeSqliteExecutor();
  const deleted: string[] = [];
  await migrate(db);
  let id = 0;
  const newId = () => `id${++id}`;
  const show = await ensureDefaultShow(db, newId, 1000, TEST_SHOW_SEED);
  await db.run(
    'INSERT INTO assets (id, show_id, kind, name, path, duration_smp, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    ['op', show.id, 'opening', 'Op', 'x', 480000, 1, 1],
  );
  await db.run(
    'INSERT INTO assets (id, show_id, kind, name, path, duration_smp, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    ['bg', show.id, 'bgm', 'Bg', 'y', 4800000, 1, 1],
  );
  await updateLayout(db, show.id, {
    openingAssetId: 'op',
    bgmAssetId: 'bg',
  });
  const svc = new EpisodeService({
    db,
    newId,
    now: () => 5000,
    labels: () => TEST_LABELS,
    root: '/data',
    deleteFile: (abs) => deleted.push(abs),
  });
  return { db, show, svc, deleted };
}

/** 声が 1 本ある Take を作る（音声削除のテスト用）。 */
async function addTake(db: Awaited<ReturnType<typeof setup>>['db'], episodeId: string, id: string) {
  await db.run(
    'INSERT INTO takes (id, episode_id, name, status, started_at, duration_smp, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    [id, episodeId, id, 'ready', 1, 48000, 1, 1],
  );
  await db.run(
    'INSERT INTO take_segments (id, take_id, seq, path, peaks_path, duration_smp, header_valid) VALUES (?,?,?,?,?,?,1)',
    [
      `${id}s`,
      id,
      1,
      `episodes/${episodeId}/takes/${id}/seg-0001.wav`,
      `episodes/${episodeId}/takes/${id}/seg-0001.peaks`,
      48000,
    ],
  );
  await db.run(
    'INSERT INTO voice_segments (id, episode_id, position, take_id, src_start_smp, src_end_smp, updated_at) VALUES (?,?,?,?,?,?,?)',
    [`${id}v`, episodeId, 0, id, 0, 48000, 1],
  );
}

describe('EpisodeService', () => {
  it('creates an episode with numbering, layout overlays and rendered template', async () => {
    const { db, show, svc } = await setup();
    const ep = await svc.create(show.id);
    expect(ep.episode_number).toBe(1);
    // 既定タイトルは空。話数は UI が `#N` として別に出す（FR-EP-6 / Issue #88）。
    expect(ep.title).toBe('');
    expect(ep.description).toContain(`Podcast: ${TEST_LABELS.showName}`);
    const doc = await loadDoc(db, ep.id);
    expect(doc.overlays.map((o) => [o.kind, o.anchor.type, o.duck, o.loop])).toEqual([
      ['opening', 'timeline_start', false, false],
      ['bgm', 'timeline_start', true, true],
    ]);
    const ep2 = await svc.create(show.id);
    expect(ep2.episode_number).toBe(2);
    expect((await svc.list(show.id)).map((e) => e.episode_number)).toEqual([2, 1]);
  });

  it('refreshStatus, remove and duplicate', async () => {
    const { db, show, svc } = await setup();
    const ep = await svc.create(show.id);
    await svc.refreshStatus(ep.id);
    expect((await svc.get(ep.id))?.status).toBe('draft');
    await db.run(
      'INSERT INTO outline_items (id, episode_id, position, heading, body, recorded_take_id, recorded_src_smp) VALUES (?,?,?,?,?,?,?)',
      ['t', ep.id, 0, 'テーマ', '台本', null, null],
    );
    const dup = await svc.duplicate(ep.id);
    expect(dup.episode_number).toBe(2);
    // 見出しと台本は引き継ぎ、チャプター（録音位置）は引き継がない。
    expect(
      await db.all(
        'SELECT heading, body, recorded_take_id FROM outline_items WHERE episode_id = ?',
        [dup.id],
      ),
    ).toEqual([{ heading: 'テーマ', body: '台本', recorded_take_id: null }]);
    await svc.remove(ep.id);
    expect((await svc.list(show.id)).map((e) => e.id)).toEqual([dup.id]);
  });

  it('duplicate carries over the export preset choice (DATA_MODEL.md §4.5.1)', async () => {
    const { show, svc } = await setup();
    const ep = await svc.create(show.id);
    const plain = await svc.duplicate(ep.id);
    expect(plain.export_preset).toBeNull();

    await svc.update(ep.id, { exportPreset: 'wav' });
    expect((await svc.get(ep.id))?.export_preset).toBe('wav');
    const dup = await svc.duplicate(ep.id);
    expect(dup.export_preset).toBe('wav');
  });

  // 以下、REQUIREMENTS.md §2.1.1 の受け入れ基準（FR-EP-6）。

  it('returns the number when a throwaway episode is deleted', async () => {
    const { show, svc } = await setup();
    const ep = await svc.create(show.id);
    expect(ep.episode_number).toBe(1);
    await svc.remove(ep.id);
    expect((await svc.create(show.id)).episode_number).toBe(1);
  });

  it('returns the number even when the deleted episode was exported', async () => {
    const { db, show, svc } = await setup();
    const ep = await svc.create(show.id);
    await db.run("UPDATE episodes SET status = 'exported' WHERE id = ?", [ep.id]);
    await svc.remove(ep.id);
    // 書き出しは公開ではないので、採番は status を見ない（予約しない）。
    expect((await svc.create(show.id)).episode_number).toBe(1);
  });

  it('does not reuse the highest number while the episode is still there', async () => {
    const { show, svc } = await setup();
    await svc.create(show.id);
    const second = await svc.create(show.id);
    const third = await svc.create(show.id);
    expect([second.episode_number, third.episode_number]).toEqual([2, 3]);
    // 間の回を消しても穴は埋めない（一覧の最大の次）。
    await svc.remove(second.id);
    expect((await svc.create(show.id)).episode_number).toBe(4);
  });

  it('purgeAudio deletes the recordings but keeps the row, number and status', async () => {
    const { db, show, svc, deleted } = await setup();
    const ep = await svc.create(show.id);
    await addTake(db, ep.id, 'take1');
    await db.run("UPDATE episodes SET status = 'exported' WHERE id = ?", [ep.id]);
    await db.run(
      'INSERT INTO edit_ops (id, episode_id, seq, label, op, created_at) VALUES (?,?,?,?,?,?)',
      ['op1', ep.id, 1, 'x', '{}', 1],
    );

    await svc.purgeAudio(ep.id);

    const after = await svc.get(ep.id);
    expect(after?.episode_number).toBe(1);
    expect(after?.status).toBe('exported');
    expect(after?.audio_purged_at).toBe(5000);
    // 実体を消したので DB 側の参照も残さない。
    expect(await loadDoc(db, ep.id)).toMatchObject({ voice: [] });
    expect(await svc.listTakes(ep.id)).toEqual([]);
    expect(await db.all('SELECT id FROM edit_ops WHERE episode_id = ?', [ep.id])).toEqual([]);
    // Opening / BGM はタイムライン固定なので残る。
    expect((await loadDoc(db, ep.id)).overlays).toHaveLength(2);
    expect(deleted).toEqual([
      `/data/episodes/${ep.id}/takes/take1/seg-0001.wav`,
      `/data/episodes/${ep.id}/takes/take1/seg-0001.peaks`,
    ]);

    // 行が残るので話数は消費したまま。
    expect((await svc.create(show.id)).episode_number).toBe(2);
    // 声が無いのが正常な状態なので draft へ戻さない。
    await svc.refreshStatus(ep.id);
    expect((await svc.get(ep.id))?.status).toBe('exported');
  });

  it('purgeAudio keeps a ready episode out of draft', async () => {
    const { db, show, svc } = await setup();
    const ep = await svc.create(show.id);
    await addTake(db, ep.id, 'take1');
    await svc.refreshStatus(ep.id);
    expect((await svc.get(ep.id))?.status).toBe('ready');
    await svc.purgeAudio(ep.id);
    await svc.refreshStatus(ep.id);
    expect((await svc.get(ep.id))?.status).toBe('ready');
  });

  describe('remove deletes the files right away (Issue #152)', () => {
    async function withFiles() {
      const ctx = await setup();
      const ep = await ctx.svc.create(ctx.show.id);
      await addTake(ctx.db, ep.id, 'take1');
      await ctx.db.run(
        'INSERT INTO exports (id, episode_id, format, preset, status, path, duration_smp, created_at) VALUES (?,?,?,?,?,?,?,?)',
        ['x1', ep.id, 'm4a', '{}', 'done', `episodes/${ep.id}/exports/x1.m4a`, 48000, 1],
      );
      return { ...ctx, ep };
    }

    it('deletes recordings and exports, then marks the episode deleted', async () => {
      const { db, show, svc, ep, deleted } = await withFiles();
      await svc.remove(ep.id);
      expect(deleted).toEqual([
        `/data/episodes/${ep.id}/takes/take1/seg-0001.wav`,
        `/data/episodes/${ep.id}/takes/take1/seg-0001.peaks`,
        `/data/episodes/${ep.id}/exports/x1.m4a`,
      ]);
      expect(await svc.list(show.id)).toEqual([]);
      // 行は削除の記録として残す（将来の同期）。中身は片付いている。
      const row = await svc.get(ep.id);
      expect(row?.deleted_at).toBe(5000);
      expect(await db.all('SELECT id FROM exports WHERE episode_id = ?', [ep.id])).toEqual([]);
      expect((await loadDoc(db, ep.id)).voice).toEqual([]);
    });

    it('leaves the DB untouched when a file cannot be deleted, and finishes on retry', async () => {
      const { db, show, ep } = await withFiles();
      const tried: string[] = [];
      let fail = true;
      const svc = new EpisodeService({
        db,
        newId: () => 'n',
        now: () => 5000,
        labels: () => TEST_LABELS,
        root: '/data',
        deleteFile: (abs) => {
          tried.push(abs);
          if (fail && abs.endsWith('.peaks')) throw new Error('busy');
        },
      });
      await expect(svc.remove(ep.id)).rejects.toMatchObject({ code: 'file_delete_failed' });
      // ファイルを先に消す。途中で失敗したら DB は変えない（回は一覧に残る）。
      expect((await svc.list(show.id)).map((e) => e.id)).toEqual([ep.id]);
      expect((await loadDoc(db, ep.id)).voice).toHaveLength(1);
      expect(await db.all('SELECT id FROM exports WHERE episode_id = ?', [ep.id])).toHaveLength(1);
      // もう一度実行すれば残りを消して DB まで進む。
      fail = false;
      await svc.remove(ep.id);
      expect(await svc.list(show.id)).toEqual([]);
    });

    it('purgeAudio also deletes files first and keeps the DB when that fails', async () => {
      const { db, ep } = await withFiles();
      const svc = new EpisodeService({
        db,
        newId: () => 'n',
        now: () => 5000,
        labels: () => TEST_LABELS,
        root: '/data',
        deleteFile: () => {
          throw new Error('busy');
        },
      });
      await expect(svc.purgeAudio(ep.id)).rejects.toMatchObject({ code: 'file_delete_failed' });
      expect((await svc.get(ep.id))?.audio_purged_at).toBeNull();
    });
  });

  describe('cleanupDeleted', () => {
    it('cleans episodes deleted before files were removed on delete', async () => {
      const { db, show, svc, deleted } = await setup();
      const ep = await svc.create(show.id);
      await addTake(db, ep.id, 'take1');
      // Issue #152 より前の削除: 行に印を付けただけでファイルが残っている。
      await db.run('UPDATE episodes SET deleted_at = 1 WHERE id = ?', [ep.id]);
      expect(await svc.cleanupDeleted()).toBe(1);
      expect(deleted).toContain(`/data/episodes/${ep.id}/takes/take1/seg-0001.wav`);
      deleted.length = 0;
      expect(await svc.cleanupDeleted()).toBe(0);
      expect(deleted).toEqual([]);
    });

    it('does not touch episodes that are not deleted', async () => {
      const { db, show, svc, deleted } = await setup();
      const ep = await svc.create(show.id);
      await addTake(db, ep.id, 'take1');
      expect(await svc.cleanupDeleted()).toBe(0);
      expect(deleted).toEqual([]);
    });
  });

  // Issue #168 / REQUIREMENTS.md FR-EP-10: 開いて何も入れずに離れた回は自動で捨てる
  describe('discardIfEmpty', () => {
    async function setupWithTopics() {
      const ctx = await setup();
      await saveShowTopicTemplate(ctx.db, ctx.show.id, () => `tp${Math.random()}`, [
        { heading: 'Opening talk', body: '' },
        { heading: 'News', body: 'three items' },
      ]);
      return ctx;
    }

    it('discards a freshly created episode and gives its number back (§2.1.1)', async () => {
      const { db, show, svc, deleted } = await setupWithTopics();
      const ep = await svc.create(show.id);
      expect(await svc.discardIfEmpty(ep.id)).toBe(true);
      expect((await getEpisode(db, ep.id))?.deleted_at).not.toBeNull();
      expect(await svc.list(show.id)).toEqual([]);
      expect(deleted).toEqual([]);
      expect((await svc.create(show.id)).episode_number).toBe(ep.episode_number);
    });

    it('does nothing for an episode that is already gone', async () => {
      const { show, svc } = await setup();
      const ep = await svc.create(show.id);
      await svc.remove(ep.id);
      expect(await svc.discardIfEmpty(ep.id)).toBe(false);
      expect(await svc.discardIfEmpty('missing')).toBe(false);
    });

    it.each([
      ['a title', { title: 'Hello' }],
      ['the description', { description: 'my notes' }],
      ['the episode number', { episodeNumber: 7 }],
      ['the season', { season: 2 }],
      ['the recording date', { recordedAt: 1 }],
      ['the planned publish date', { publishPlannedAt: 9999 }],
      ['the episode type', { episodeType: 'bonus' as const }],
      ['explicit', { explicit: true }],
      ['the web page', { websiteUrl: 'https://example.test' }],
      ['the sound settings', { soundSettings: JSON.stringify({ ducking: { enabled: false } }) }],
    ])('keeps an episode when %s was changed', async (_label, patch) => {
      const { show, svc } = await setup();
      const ep = await svc.create(show.id);
      await svc.update(ep.id, patch);
      expect(await svc.discardIfEmpty(ep.id)).toBe(false);
    });

    it('treats explicitly written default sound settings as untouched', async () => {
      const { show, svc } = await setup();
      const ep = await svc.create(show.id);
      await svc.update(ep.id, {
        soundSettings: JSON.stringify({ loudness: { enabled: true, targetLufs: -16 } }),
      });
      expect(await svc.discardIfEmpty(ep.id)).toBe(true);
    });

    it.each(['ready', 'recording', 'failed'])(
      'keeps an episode that has any recording (%s), even one in the trash',
      async (status) => {
        const { db, show, svc } = await setup();
        const ep = await svc.create(show.id);
        await db.run(
          'INSERT INTO takes (id, episode_id, name, status, started_at, duration_smp, deleted_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
          ['t1', ep.id, 't1', status, 1, 0, 2, 1, 1],
        );
        expect(await svc.discardIfEmpty(ep.id)).toBe(false);
      },
    );

    it('keeps an episode that has an export row', async () => {
      const { db, show, svc } = await setup();
      const ep = await svc.create(show.id);
      await db.run(
        'INSERT INTO exports (id, episode_id, format, preset, status, duration_smp, created_at) VALUES (?,?,?,?,?,?,?)',
        ['x1', ep.id, 'm4a', '{}', 'failed', 0, 1],
      );
      expect(await svc.discardIfEmpty(ep.id)).toBe(false);
    });

    it('keeps an episode linked to a published episode (explicit link or GUID)', async () => {
      const { db, show, svc } = await setup();
      const linked = await svc.create(show.id);
      const byGuid = await svc.create(show.id);
      const insertFeed = (id: string, guid: string, episodeId: string | null) =>
        db.run(
          `INSERT INTO feed_episodes (id, show_id, guid, title, description, episode_type, website_url, episode_id, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [id, show.id, guid, '', '', 'full', '', episodeId, 1, 1],
        );
      await insertFeed('f1', 'other', linked.id);
      await insertFeed('f2', byGuid.guid!, null);
      expect(await svc.discardIfEmpty(linked.id)).toBe(false);
      expect(await svc.discardIfEmpty(byGuid.id)).toBe(false);
    });

    it('keeps an episode whose talk topics differ from the show template', async () => {
      const { db, show, svc } = await setupWithTopics();
      const edited = await svc.create(show.id);
      const [first, second] = await listOutline(db, edited.id);
      await saveOutline(db, edited.id, [{ ...first!, heading: 'Changed' }, second!]);
      expect(await svc.discardIfEmpty(edited.id)).toBe(false);

      const removed = await svc.create(show.id);
      await saveOutline(db, removed.id, [(await listOutline(db, removed.id))[0]!]);
      expect(await svc.discardIfEmpty(removed.id)).toBe(false);
    });

    it('keeps an episode whose overlays differ from the show layout', async () => {
      const { db, show, svc } = await setup();
      const ep = await svc.create(show.id);
      const doc = await loadDoc(db, ep.id);
      await saveDoc(db, ep.id, { voice: [], overlays: doc.overlays.slice(1) }, 6000);
      expect(await svc.discardIfEmpty(ep.id)).toBe(false);
    });

    it('keeps an older empty episode while a later one exists (its number is not the next one)', async () => {
      const { show, svc } = await setup();
      const first = await svc.create(show.id);
      const second = await svc.create(show.id);
      await svc.update(second.id, { title: 'Recorded later' });
      expect(await svc.discardIfEmpty(first.id)).toBe(false);
    });
  });

  describe('discardEmptyOpened', () => {
    it('discards empty episodes that were opened, newest first', async () => {
      const { db, show, svc } = await setup();
      const a = await svc.create(show.id);
      const b = await svc.create(show.id);
      await db.run('UPDATE episodes SET last_opened_at = created_at + 1');
      // #2 を先に捨てれば、#1 も「いま作ったときと同じ番号」になる
      expect(await svc.discardEmptyOpened(show.id)).toBe(2);
      expect((await getEpisode(db, a.id))?.deleted_at).not.toBeNull();
      expect((await getEpisode(db, b.id))?.deleted_at).not.toBeNull();
    });

    it('keeps episodes that were never opened (e.g. a duplicate) and ones with input', async () => {
      const { db, show, svc } = await setup();
      const notOpened = await svc.create(show.id);
      const withTitle = await svc.create(show.id);
      await svc.update(withTitle.id, { title: 'Draft idea' });
      await db.run('UPDATE episodes SET last_opened_at = created_at + 1 WHERE id = ?', [
        withTitle.id,
      ]);
      expect(await svc.discardEmptyOpened(show.id)).toBe(0);
      expect(await svc.list(show.id)).toHaveLength(2);
      expect((await getEpisode(db, notOpened.id))?.deleted_at).toBeNull();
    });
  });
});
