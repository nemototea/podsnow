import { createNodeSqliteExecutor } from '@/infra/db/__tests__/nodeSqliteExecutor';
import { migrate } from '@/infra/db/migrate';
import { loadDoc } from '@/infra/db/repositories/editableDocRepo';
import { ensureDefaultShow, updateLayout } from '@/infra/db/repositories/showsRepo';
import { TEST_LABELS, TEST_SHOW_SEED } from '@/services/app/__tests__/labels';

import { EpisodeService } from '../EpisodeService';

async function setup() {
  const db = createNodeSqliteExecutor();
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
  const svc = new EpisodeService({ db, newId, now: () => 5000, labels: () => TEST_LABELS });
  return { db, show, svc };
}

describe('EpisodeService', () => {
  it('creates an episode with numbering, layout overlays and rendered template', async () => {
    const { db, show, svc } = await setup();
    const ep = await svc.create(show.id);
    expect(ep.episode_number).toBe(1);
    // 既定タイトル・テンプレートは呼び出し側（UI 層の i18n）が渡す（Issue #80）。
    expect(ep.title).toBe(TEST_LABELS.episodeTitle(1));
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

  it('refreshStatus, remove/restore and duplicate', async () => {
    const { db, show, svc } = await setup();
    const ep = await svc.create(show.id);
    await svc.refreshStatus(ep.id);
    expect((await svc.get(ep.id))?.status).toBe('draft');
    await db.run('INSERT INTO topics (id, episode_id, position, text) VALUES (?,?,?,?)', [
      't',
      ep.id,
      0,
      'テーマ',
    ]);
    const dup = await svc.duplicate(ep.id);
    expect(dup.episode_number).toBe(2);
    expect(await db.all('SELECT text FROM topics WHERE episode_id = ?', [dup.id])).toEqual([
      { text: 'テーマ' },
    ]);
    await svc.remove(ep.id);
    expect((await svc.list(show.id)).map((e) => e.id)).toEqual([dup.id]);
    await svc.restore(ep.id);
    expect(await svc.list(show.id)).toHaveLength(2);
  });
});
