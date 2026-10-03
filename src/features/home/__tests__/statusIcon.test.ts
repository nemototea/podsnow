import type { EpisodeListItem } from '@/infra/db/repositories/episodesRepo';
import type { HomeEpisodeItem } from '@/services/home/HomeService';

import { episodeStatusKind, STATUS_ICON } from '../statusIcon';

const local = (more: Partial<EpisodeListItem> = {}): EpisodeListItem =>
  ({
    id: 'ep-1',
    status: 'ready',
    audio_purged_at: null,
    take_count: 1,
    duration_smp: 48000,
    ...more,
  }) as EpisodeListItem;

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

const feed = {} as NonNullable<HomeEpisodeItem['feed']>;

describe('Home のエピソードの状態（FR-EP-3、Issue #171）', () => {
  it('配信済み・音声なし・未録音・書き出しの状態の順に判定する', () => {
    expect(episodeStatusKind(item({ feed }))).toBe('published');
    expect(episodeStatusKind(item({ local: local(), feed }))).toBe('published');
    expect(episodeStatusKind(item({ local: local({ audio_purged_at: 1 }) }))).toBe('noAudio');
    expect(episodeStatusKind(item({ local: local({ take_count: 0 }) }))).toBe('new');
    expect(episodeStatusKind(item({ local: local({ status: 'draft' }) }))).toBe('draft');
    expect(episodeStatusKind(item({ local: local() }))).toBe('ready');
    expect(episodeStatusKind(item({ local: local({ status: 'exported' }) }))).toBe('exported');
  });

  it('意味の違う状態は違うアイコン（下書きと準備 OK はどちらも編集中）', () => {
    const meanings = [
      STATUS_ICON.new,
      STATUS_ICON.ready,
      STATUS_ICON.exported,
      STATUS_ICON.published,
      STATUS_ICON.noAudio,
    ];
    expect(new Set(meanings).size).toBe(meanings.length);
    expect(STATUS_ICON.draft).toBe(STATUS_ICON.ready);
  });

  it('未録音を録音の操作に、音声なしを音量に見せない', () => {
    expect(['mic', 'record']).not.toContain(STATUS_ICON.new);
    expect(STATUS_ICON.exported).not.toBe('check');
    expect(STATUS_ICON.published).not.toBe('check');
  });
});
