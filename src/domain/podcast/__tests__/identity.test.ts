import {
  judgeShowIdentity,
  normalizeFeedUrl,
  type CurrentShowIdentity,
  type IncomingShowIdentity,
} from '../identity';

const cur = (p: Partial<CurrentShowIdentity> = {}): CurrentShowIdentity => ({
  imported: true,
  feedUrl: null,
  podcastGuid: null,
  appleId: null,
  episodeGuids: [],
  ...p,
});
const inc = (p: Partial<IncomingShowIdentity> = {}): IncomingShowIdentity => ({
  feedUrls: [],
  podcastGuid: null,
  appleId: null,
  episodeGuids: [],
  ...p,
});

describe('judgeShowIdentity (docs/podcast-import-cases.md §5)', () => {
  it('is new when nothing has been imported yet', () => {
    expect(
      judgeShowIdentity(cur({ imported: false, podcastGuid: 'a' }), inc({ podcastGuid: 'b' })),
    ).toBe('new');
  });

  it('decides by podcast:guid first, even when URLs match', () => {
    expect(judgeShowIdentity(cur({ podcastGuid: 'ABC' }), inc({ podcastGuid: 'abc' }))).toBe(
      'same',
    );
    expect(
      judgeShowIdentity(
        cur({ podcastGuid: 'a', feedUrl: 'https://f.example.com/x' }),
        inc({ podcastGuid: 'b', feedUrls: ['https://f.example.com/x'] }),
      ),
    ).toBe('different');
  });

  it('then by Apple id', () => {
    expect(judgeShowIdentity(cur({ appleId: '1' }), inc({ appleId: '1' }))).toBe('same');
    expect(judgeShowIdentity(cur({ appleId: '1' }), inc({ appleId: '2' }))).toBe('different');
  });

  it('B-2: treats a moved feed as the same show when any candidate URL matches', () => {
    expect(
      judgeShowIdentity(
        cur({ feedUrl: 'http://Feeds.Example.com/show.xml/' }),
        inc({ feedUrls: ['https://new.example.com/feed', 'https://feeds.example.com/show.xml'] }),
      ),
    ).toBe('same');
  });

  it('falls back to guid overlap', () => {
    const c = cur({ feedUrl: 'https://old.example.com/', episodeGuids: ['1', '2', '3', '4'] });
    expect(judgeShowIdentity(c, inc({ episodeGuids: ['3', '4', '5'] }))).toBe('same');
    expect(judgeShowIdentity(c, inc({ episodeGuids: ['4', '9'] }))).toBe('different');
    expect(judgeShowIdentity(cur({ feedUrl: 'https://a/' }), inc({ episodeGuids: ['1'] }))).toBe(
      'different',
    );
  });
});

describe('normalizeFeedUrl', () => {
  it('ignores scheme, host case and trailing slashes but keeps path case', () => {
    expect(normalizeFeedUrl('HTTPS://Feeds.Example.COM/Show.xml//')).toBe(
      'feeds.example.com/Show.xml',
    );
    expect(normalizeFeedUrl('http://feeds.example.com')).toBe('feeds.example.com');
  });
});
