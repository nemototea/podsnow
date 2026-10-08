import { smp } from '@/domain/time';
import type { EpisodeListItem } from '@/infra/db/repositories/episodesRepo';
import type { FeedEpisodeRow } from '@/infra/db/repositories/feedEpisodesRepo';
import type { PlaybackSource } from '@/services/audio/PlaybackService';
import type { HomeEpisodeItem } from '@/services/home/HomeService';

import { playerDetails } from '../playerDetails';

const local = (more: Partial<EpisodeListItem> = {}): EpisodeListItem =>
  ({ id: 'ep-1', description: '手元の概要', recorded_at: 1000, ...more }) as EpisodeListItem;
const feed = (more: Partial<FeedEpisodeRow> = {}): FeedEpisodeRow =>
  ({
    id: 'f-1',
    description: '<p>配信の<b>概要</b></p>',
    published_at: 2000,
    ...more,
  }) as FeedEpisodeRow;
const item = (more: Partial<HomeEpisodeItem>): HomeEpisodeItem => ({
  key: 'k',
  local: null,
  feed: null,
  title: 't',
  episodeNumber: 1,
  durationSmp: 0,
  publishedAt: null,
  ...more,
});

const rss: PlaybackSource = {
  kind: 'rss',
  homeKey: 'k',
  episodeId: null,
  feedEpisodeId: 'f-1',
  title: 't',
  episodeNumber: 1,
  duration: smp(48000),
};
const exp: PlaybackSource = {
  kind: 'export',
  homeKey: 'k',
  episodeId: 'ep-1',
  exportId: 'x',
  title: 't',
  episodeNumber: 1,
  duration: smp(48000),
};

describe('プレーヤー画面の補足（Issue #188）', () => {
  it('配信の音声は配信日と、文字だけにした配信の概要', () => {
    expect(playerDetails(rss, item({ feed: feed(), local: local() }))).toEqual({
      date: { kind: 'published', at: 2000 },
      description: '配信の概要',
    });
  });

  it('書き出しは収録日と手元の概要。手元が空なら配信の概要', () => {
    expect(playerDetails(exp, item({ local: local(), feed: feed() }))).toEqual({
      date: { kind: 'recorded', at: 1000 },
      description: '手元の概要',
    });
    expect(playerDetails(exp, item({ local: local({ description: ' ' }), feed: feed() }))).toEqual({
      date: { kind: 'recorded', at: 1000 },
      description: '配信の概要',
    });
  });

  it('行が読めないときは何も出さない', () => {
    expect(playerDetails(exp, null)).toEqual({ date: null, description: '' });
    expect(playerDetails(rss, null)).toEqual({ date: null, description: '' });
  });
});
