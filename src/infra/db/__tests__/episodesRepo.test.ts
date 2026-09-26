import { migrate } from '../migrate';
import {
  getEpisode,
  insertEpisode,
  parseEpisodeExportPreset,
  updateEpisode,
} from '../repositories/episodesRepo';
import { createNodeSqliteExecutor } from './nodeSqliteExecutor';

async function setup() {
  const db = createNodeSqliteExecutor();
  await migrate(db);
  await db.run('INSERT INTO shows (id, created_at, updated_at) VALUES (?,?,?)', ['s1', 1, 1]);
  await insertEpisode(db, {
    id: 'e1',
    showId: 's1',
    title: '第1回',
    description: '',
    episodeNumber: 1,
    season: 1,
    now: 1,
  });
  return db;
}

describe('episodes.export_preset (DATA_MODEL.md §4.5.1)', () => {
  it('starts as NULL for a new episode', async () => {
    const db = await setup();
    expect((await getEpisode(db, 'e1'))?.export_preset).toBeNull();
  });

  it('saves the chosen preset, bumps updated_at and leaves other columns alone', async () => {
    const db = await setup();
    await updateEpisode(db, 'e1', { exportPreset: 'wav' }, 50);
    const ep = await getEpisode(db, 'e1');
    expect(ep).toMatchObject({ export_preset: 'wav', title: '第1回', updated_at: 50 });

    await updateEpisode(db, 'e1', { exportPreset: 'custom' }, 60);
    expect((await getEpisode(db, 'e1'))?.export_preset).toBe('custom');
  });

  it('keeps the preset when other fields are updated, and clears it with null', async () => {
    const db = await setup();
    await updateEpisode(db, 'e1', { exportPreset: 'high' }, 50);
    await updateEpisode(db, 'e1', { title: '改題' }, 60);
    expect(await getEpisode(db, 'e1')).toMatchObject({ export_preset: 'high', title: '改題' });

    await updateEpisode(db, 'e1', { exportPreset: null }, 70);
    expect((await getEpisode(db, 'e1'))?.export_preset).toBeNull();
  });

  it('parses only the known preset keys', () => {
    for (const k of ['podcast', 'high', 'wav', 'custom'] as const) {
      expect(parseEpisodeExportPreset(k)).toBe(k);
    }
    for (const v of [null, undefined, '', 'mp3', 'WAV', 1, { key: 'wav' }]) {
      expect(parseEpisodeExportPreset(v)).toBeNull();
    }
  });
});
