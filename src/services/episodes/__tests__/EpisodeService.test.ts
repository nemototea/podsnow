import type { EditableDoc } from '@/domain/editing/doc';
import { smp, ZERO_SMP } from '@/domain/time';
import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';
import { loadDoc, saveDoc } from '@/infra/db/repositories/editableDocRepo';
import type { PodcastFeedItem } from '@/domain/podcast/feed';
import { getEpisode } from '@/infra/db/repositories/episodesRepo';
import { upsertFeedEpisodes } from '@/infra/db/repositories/feedEpisodesRepo';
import {
  getEpisodeNotes,
  setEpisodeNotes,
  setShowNotesTemplate,
} from '@/infra/db/repositories/notesRepo';
import { ensureDefaultShow, getLayout, updateLayout } from '@/infra/db/repositories/showsRepo';
import { TEST_LABELS, TEST_SHOW_SEED } from '@/services/app/__tests__/labels';
import { parseSoundSettings } from '@/services/audio/renderDocumentFromDb';

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

type Db = Awaited<ReturnType<typeof setup>>['db'];

/** 配信済みの回を入れる（取り込みと同じ経路）。`day` は配信日（日）。 */
async function publish(
  db: Db,
  showId: string,
  items: {
    guid: string;
    day: number;
    n?: number | null;
    season?: number | null;
    type?: PodcastFeedItem['episodeType'];
  }[],
) {
  await upsertFeedEpisodes(
    db,
    showId,
    items.map((i) => ({
      guid: i.guid,
      title: i.guid,
      description: '',
      publishedAt: i.day * 86_400_000,
      enclosureUrl: null,
      enclosureLength: null,
      enclosureType: null,
      durationSmp: null,
      episodeNumber: i.n ?? null,
      season: i.season ?? null,
      episodeType: i.type ?? 'full',
      explicit: null,
      websiteUrl: '',
      imageUrl: null,
    })),
    () => `feed-${Math.random()}`,
    1000,
  );
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
    // 配信済みの回が無いので話数・シーズンは空（REQUIREMENTS.md §2.1.1）
    expect([ep.episode_number, ep.season]).toEqual([null, null]);
    // 既定タイトルは空。話数は UI が `#N` として別に出す（FR-EP-6 / Issue #88）。
    expect(ep.title).toBe('');
    expect(ep.description).toContain(`Podcast: ${TEST_LABELS.showName}`);
    const doc = await loadDoc(db, ep.id);
    expect(doc.overlays.map((o) => [o.kind, o.anchor.type, o.loop])).toEqual([
      ['opening', 'timeline_start', false],
      ['bgm', 'timeline_start', true],
    ]);
    // オープニングは本編の前に置き、流し終えてから話す（Issue #254）
    expect(doc.overlays[0]!.anchor).toEqual({ type: 'timeline_start', offset: -480000 });
    expect(doc.overlays[1]).toMatchObject({ fadeIn: 48000, fadeOut: 96000 });
    expect(doc.overlays[1]!.endOffset).toBeUndefined();
    const ep2 = await svc.create(show.id);
    // 一覧は作った順の新しい方から（話数に関係なく。Issue #211）
    expect((await svc.list(show.id)).map((e) => e.id)).toEqual([ep2.id, ep.id]);
  });

  it('この回の構成を番組の既定にすると、次の回がその形で始まる（Issue #254）', async () => {
    const { db, show, svc } = await setup();
    await db.run(
      'INSERT INTO assets (id, show_id, kind, name, path, duration_smp, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      ['ed', show.id, 'ending', 'Ed', 'z', 96000, 1, 1],
    );
    const ep = await svc.create(show.id);
    const doc = await loadDoc(db, ep.id);
    const [op, bgm] = doc.overlays;
    // 本編がオープニングに 1 秒重なり、BGM はオープニングの 2 秒前から始まってエンディングの下まで続く
    const edited = {
      voice: [],
      overlays: [
        {
          ...op!,
          anchor: { type: 'timeline_start', offset: smp(-480000 + 48000) },
          fadeOut: smp(24000),
        },
        {
          ...bgm!,
          anchor: { type: 'timeline_start', offset: smp(-96000) },
          endOffset: smp(96000),
          gainDb: -20,
        },
        {
          ...op!,
          id: 'edc',
          assetId: 'ed',
          kind: 'ending',
          anchor: { type: 'timeline_end', offset: smp(96000 + 48000) },
          fadeIn: ZERO_SMP,
          fadeOut: smp(144000),
        },
      ],
    } satisfies EditableDoc;
    await saveDoc(db, ep.id, edited, 6000);
    await svc.saveStructureAsDefault(ep.id);

    const next = await loadDoc(db, (await svc.create(show.id)).id);
    const strip = (d: EditableDoc) => d.overlays.map(({ id: _id, ...rest }) => rest);
    expect(strip(next)).toEqual(
      expect.arrayContaining(strip({ voice: [], overlays: edited.overlays })),
    );
    expect(next.overlays).toHaveLength(3);
  });

  it('既定にした回から外した素材は、次の回に付かない', async () => {
    const { db, show, svc } = await setup();
    const ep = await svc.create(show.id);
    const doc = await loadDoc(db, ep.id);
    await saveDoc(
      db,
      ep.id,
      { voice: [], overlays: doc.overlays.filter((o) => o.kind !== 'bgm') },
      6000,
    );
    await svc.saveStructureAsDefault(ep.id);
    const next = await loadDoc(db, (await svc.create(show.id)).id);
    expect(next.overlays.map((o) => o.kind)).toEqual(['opening']);
  });

  it('BGM を下げる量は番組の既定を写し、写した後は番組を変えても変わらない（Issue #174）', async () => {
    const { db, show, svc } = await setup();
    await updateLayout(db, show.id, { bgmDuckDb: -14 });
    const ep = await svc.create(show.id);
    expect(parseSoundSettings(ep.sound_settings).ducking).toMatchObject({
      enabled: true,
      depthDb: -14,
    });
    await updateLayout(db, show.id, { bgmDuckDb: -6 });
    const again = await getEpisode(db, ep.id);
    expect(parseSoundSettings(again!.sound_settings).ducking.depthDb).toBe(-14);
    const next = await svc.create(show.id);
    expect(parseSoundSettings(next.sound_settings).ducking.depthDb).toBe(-6);
  });

  it('この構成を既定にすると、その回の BGM を下げる量も番組の既定になる（Issue #263）', async () => {
    const { db, show, svc } = await setup();
    await updateLayout(db, show.id, { bgmDuckDb: -10 });
    const ep = await svc.create(show.id);
    const sound = parseSoundSettings(ep.sound_settings);
    await svc.update(ep.id, {
      soundSettings: JSON.stringify({ ...sound, ducking: { ...sound.ducking, depthDb: -16 } }),
    });
    await svc.saveStructureAsDefault(ep.id);
    expect((await getLayout(db, show.id)).bgm_duck_db).toBe(-16);
    const next = await svc.create(show.id);
    expect(parseSoundSettings(next.sound_settings).ducking.depthDb).toBe(-16);
  });

  it('refreshStatus, remove and duplicate', async () => {
    const { db, show, svc } = await setup();
    const ep = await svc.create(show.id);
    await svc.refreshStatus(ep.id);
    expect((await svc.get(ep.id))?.status).toBe('draft');
    await setEpisodeNotes(db, ep.id, 'オープニング\n・近況');
    const dup = await svc.duplicate(ep.id);
    expect(dup.episode_number).toBeNull();
    // カンペは引き継ぐ（FR-OUT-3）
    expect(await getEpisodeNotes(db, dup.id)).toBe('オープニング\n・近況');
    await svc.remove(ep.id);
    expect((await svc.list(show.id)).map((e) => e.id)).toEqual([dup.id]);
  });

  it('copies the show notes template into a new episode, and later template edits do not follow (FR-SHOW-4)', async () => {
    const { db, show, svc } = await setup();
    expect(await getEpisodeNotes(db, (await svc.create(show.id)).id)).toBe('');
    await setShowNotesTemplate(db, show.id, 'オープニング\nお便り');
    const ep = await svc.create(show.id);
    expect(await getEpisodeNotes(db, ep.id)).toBe('オープニング\nお便り');
    await setShowNotesTemplate(db, show.id, '別の文章');
    expect(await getEpisodeNotes(db, ep.id)).toBe('オープニング\nお便り');
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

  // 以下、REQUIREMENTS.md §2.1.1 の受け入れ基準（FR-EP-6、Issue #211）。

  it('starts after the latest published full episode, with the same season', async () => {
    const { db, show, svc } = await setup();
    await publish(db, show.id, [
      { guid: 'g119', day: 1, n: 119, season: 2 },
      { guid: 'g120', day: 2, n: 120, season: 2 },
    ]);
    const ep = await svc.create(show.id);
    expect([ep.episode_number, ep.season]).toEqual([121, 2]);
    // 手元の回は見ないので、読み込み直す前に作った次の回も同じ番号（重なってよい）
    expect((await svc.create(show.id)).episode_number).toBe(121);
  });

  it('skips trailers and bonus episodes, and leaves numbers empty when the base has none', async () => {
    const { db, show, svc } = await setup();
    await publish(db, show.id, [
      { guid: 'g12', day: 1, n: 12, season: 1 },
      { guid: 'bonus', day: 2, type: 'bonus' },
    ]);
    expect((await svc.create(show.id)).episode_number).toBe(13);
    // 最新の本編に話数が無ければ空（古い回にだけ番号がある番組）
    await publish(db, show.id, [{ guid: 'g13', day: 3, n: 0, season: 0 }]);
    const ep = await svc.create(show.id);
    expect([ep.episode_number, ep.season]).toEqual([null, null]);
  });

  it('does not depend on deleted or exported local episodes', async () => {
    const { db, show, svc } = await setup();
    await publish(db, show.id, [{ guid: 'g5', day: 1, n: 5 }]);
    const ep = await svc.create(show.id);
    await db.run("UPDATE episodes SET status = 'exported' WHERE id = ?", [ep.id]);
    await svc.update(ep.id, { episodeNumber: 40 });
    expect((await svc.create(show.id)).episode_number).toBe(6);
    await svc.remove(ep.id);
    expect((await svc.create(show.id)).episode_number).toBe(6);
  });

  it('duplicate decides the number and season the same way as a new episode', async () => {
    const { db, show, svc } = await setup();
    await publish(db, show.id, [{ guid: 'g8', day: 1, n: 8, season: 3 }]);
    const ep = await svc.create(show.id);
    await svc.update(ep.id, { episodeNumber: 30, season: 9 });
    const dup = await svc.duplicate(ep.id);
    expect([dup.episode_number, dup.season]).toEqual([9, 3]);
  });

  it('can clear the episode number and season', async () => {
    const { db, show, svc } = await setup();
    await publish(db, show.id, [{ guid: 'g1', day: 1, n: 1, season: 1 }]);
    const ep = await svc.create(show.id);
    await svc.update(ep.id, { episodeNumber: null, season: null });
    expect(await svc.get(ep.id)).toMatchObject({ episode_number: null, season: null });
  });

  it('purgeAudio deletes the recordings but keeps the row, number and status', async () => {
    const { db, show, svc, deleted } = await setup();
    const ep = await svc.create(show.id);
    await svc.update(ep.id, { episodeNumber: 5 });
    await addTake(db, ep.id, 'take1');
    await db.run("UPDATE episodes SET status = 'exported' WHERE id = ?", [ep.id]);
    await db.run(
      'INSERT INTO edit_ops (id, episode_id, seq, label, op, created_at) VALUES (?,?,?,?,?,?)',
      ['op1', ep.id, 1, 'x', '{}', 1],
    );

    await svc.purgeAudio(ep.id);

    const after = await svc.get(ep.id);
    expect(after?.episode_number).toBe(5);
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
    async function setupWithNotes() {
      const ctx = await setup();
      await setShowNotesTemplate(ctx.db, ctx.show.id, 'Opening talk\nNews: three items');
      return ctx;
    }

    it('discards a freshly created episode', async () => {
      const { db, show, svc, deleted } = await setupWithNotes();
      const ep = await svc.create(show.id);
      expect(await svc.discardIfEmpty(ep.id)).toBe(true);
      expect((await getEpisode(db, ep.id))?.deleted_at).not.toBeNull();
      expect(await svc.list(show.id)).toEqual([]);
      expect(deleted).toEqual([]);
    });

    // Issue #211: 話数・シーズンは「いま新しく作ったときの値」と比べる
    it('discards an episode whose number and season are the suggested ones', async () => {
      const { db, show, svc } = await setup();
      await publish(db, show.id, [{ guid: 'g12', day: 1, n: 12, season: 2 }]);
      const ep = await svc.create(show.id);
      expect([ep.episode_number, ep.season]).toEqual([13, 2]);
      expect(await svc.discardIfEmpty(ep.id)).toBe(true);
    });

    it('keeps an episode when the published episodes changed after it was made', async () => {
      const { db, show, svc } = await setup();
      await publish(db, show.id, [{ guid: 'g12', day: 1, n: 12 }]);
      const ep = await svc.create(show.id);
      await publish(db, show.id, [{ guid: 'g13', day: 2, n: 13 }]);
      // いまなら #14 になるので「作ったとき」と区別できない。消しすぎない側に倒す
      expect(await svc.discardIfEmpty(ep.id)).toBe(false);
    });

    it('keeps an episode whose suggested number was cleared', async () => {
      const { db, show, svc } = await setup();
      await publish(db, show.id, [{ guid: 'g12', day: 1, n: 12 }]);
      const ep = await svc.create(show.id);
      await svc.update(ep.id, { episodeNumber: null });
      expect(await svc.discardIfEmpty(ep.id)).toBe(false);
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

    // Issue #174: 新しい回は番組の既定（BGM を下げる量）を写すので、それと同じなら空とみなす
    it('treats sound settings copied from the show defaults as untouched', async () => {
      const { db, show, svc } = await setup();
      await db.run('UPDATE show_layout SET bgm_duck_db = ? WHERE show_id = ?', [-18, show.id]);
      const ep = await svc.create(show.id);
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

    it('keeps an episode whose notes differ from the show template', async () => {
      const { db, show, svc } = await setupWithNotes();
      const edited = await svc.create(show.id);
      await setEpisodeNotes(db, edited.id, 'Opening talk\nNews: four items');
      expect(await svc.discardIfEmpty(edited.id)).toBe(false);

      const cleared = await svc.create(show.id);
      await setEpisodeNotes(db, cleared.id, '');
      expect(await svc.discardIfEmpty(cleared.id)).toBe(false);
    });

    it('keeps an episode whose overlays differ from the show layout', async () => {
      const { db, show, svc } = await setup();
      const ep = await svc.create(show.id);
      const doc = await loadDoc(db, ep.id);
      await saveDoc(db, ep.id, { voice: [], overlays: doc.overlays.slice(1) }, 6000);
      expect(await svc.discardIfEmpty(ep.id)).toBe(false);
    });

    it('discards an older empty episode even while a later one exists (local episodes do not count)', async () => {
      const { show, svc } = await setup();
      const first = await svc.create(show.id);
      const second = await svc.create(show.id);
      await svc.update(second.id, { title: 'Recorded later' });
      expect(await svc.discardIfEmpty(first.id)).toBe(true);
    });
  });

  describe('discardEmptyOpened', () => {
    it('discards empty episodes that were opened, newest first', async () => {
      const { db, show, svc } = await setup();
      const a = await svc.create(show.id);
      const b = await svc.create(show.id);
      await db.run('UPDATE episodes SET last_opened_at = created_at + 1');
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
