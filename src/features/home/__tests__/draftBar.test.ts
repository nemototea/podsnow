import type { EpisodeListItem } from '@/infra/db/repositories/episodesRepo';
import type { HomeEpisodeItem } from '@/services/home/HomeService';

import { draftBar, pickDraft } from '../draftBar';

const local = (more: Partial<EpisodeListItem> = {}): EpisodeListItem =>
  ({
    id: 'ep-1',
    status: 'draft',
    audio_purged_at: null,
    take_count: 1,
    duration_smp: 48000,
    ...more,
  }) as EpisodeListItem;

const item = (key: string, more: Partial<HomeEpisodeItem>): HomeEpisodeItem => ({
  key,
  local: null,
  feed: null,
  title: 't',
  episodeNumber: 1,
  durationSmp: 0,
  publishedAt: null,
  ...more,
});

describe('下書きバーに出す回（DESIGN_SYSTEM.md §8）', () => {
  it('録音があってまだ書き出していない、いちばん上の手元の回', () => {
    const list = [
      item('new', { local: local({ take_count: 0 }) }),
      item('exported', { local: local({ status: 'exported' }), hasCurrentExport: true }),
      item('purged', { local: local({ audio_purged_at: 1 }) }),
      item('draft', { local: local() }),
      item('ready', { local: local({ status: 'ready' }) }),
    ];
    expect(pickDraft(list)?.key).toBe('draft');
  });

  it('配信済みだけ・空なら出さない', () => {
    expect(pickDraft([item('feed', { feed: {} as NonNullable<HomeEpisodeItem['feed']> })])).toBe(
      null,
    );
    expect(pickDraft([])).toBe(null);
  });

  it('同じ回なら知らせない。替わったら購読者に知らせる', () => {
    const fn = jest.fn();
    const off = draftBar.subscribe(fn);
    const a = item('a', { local: local(), durationSmp: 10 });
    draftBar.set(a);
    draftBar.set({ ...a });
    expect(fn).toHaveBeenCalledTimes(1);
    draftBar.set(null);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(draftBar.get()).toBe(null);
    off();
  });
});
