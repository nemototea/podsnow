import { AppError } from '../../errors';
import {
  clip,
  declaredEncoding,
  FEED_LIMITS,
  htmlToPlainText,
  parsePodcastFeed,
  parseRfc2822Date,
} from '../parseFeed';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:podcast="https://podcastindex.org/namespace/1.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <atom:link href="https://feeds.example.com/show.xml" rel="self" type="application/rss+xml"/>
    <title>テスト番組</title>
    <link>https://example.com</link>
    <language>ja-JP</language>
    <copyright>© 2026 Example</copyright>
    <description><![CDATA[<p>毎週の雑談。</p><p>お便りは<a href="https://example.com/form">こちら</a>&nbsp;へ</p>]]></description>
    <itunes:author>Example 太郎</itunes:author>
    <itunes:owner>
      <itunes:name>Example Owner</itunes:name>
      <itunes:email>owner@example.com</itunes:email>
    </itunes:owner>
    <itunes:image href="https://example.com/art.jpg"/>
    <itunes:category text="Society &amp; Culture">
      <itunes:category text="Documentary"/>
    </itunes:category>
    <itunes:category text="Technology"/>
    <itunes:category text="Technology"/>
    <itunes:explicit>false</itunes:explicit>
    <itunes:type>serial</itunes:type>
    <podcast:guid>ead4c236-bf58-58c6-a2c6-a6b28d128cb6</podcast:guid>
    <podcast:locked owner="owner@example.com">yes</podcast:locked>
    <podcast:funding url="https://example.com/support">応援する</podcast:funding>
    <item>
      <title>第2回</title>
      <guid isPermaLink="false">ep-2</guid>
      <pubDate>Tue, 01 Sep 2026 09:00:00 +0900</pubDate>
      <description><![CDATA[<p>二回目</p>]]></description>
      <enclosure url="https://cdn.example.com/2.mp3" length="12345678" type="audio/mpeg"/>
      <itunes:duration>01:02:03</itunes:duration>
      <itunes:episode>2</itunes:episode>
      <itunes:season>1</itunes:season>
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:explicit>true</itunes:explicit>
      <itunes:image href="https://example.com/2.jpg"/>
      <link>https://example.com/2</link>
    </item>
    <item>
      <title>予告</title>
      <guid>trailer</guid>
      <pubDate>Mon, 24 Aug 2026 00:00:00 GMT</pubDate>
      <content:encoded><![CDATA[本文は content:encoded だけ]]></content:encoded>
      <enclosure url="https://cdn.example.com/t.mp3" length="abc" type="audio/mpeg"/>
      <itunes:duration>90</itunes:duration>
      <itunes:episodeType>trailer</itunes:episodeType>
    </item>
    <item>
      <title>guid なし（古いフィード）</title>
      <enclosure url="https://cdn.example.com/old.mp3" length="1" type="audio/mpeg"/>
    </item>
    <item>
      <title>音声も guid も無い</title>
    </item>
    <item>
      <title>重複</title>
      <guid>ep-2</guid>
    </item>
  </channel>
</rss>`;

describe('parsePodcastFeed', () => {
  it('maps channel elements to show metadata', () => {
    const { show } = parsePodcastFeed(FEED, 'https://example.com/fetched.xml');
    expect(show).toEqual({
      title: 'テスト番組',
      description: '毎週の雑談。\nお便りはこちら へ',
      author: 'Example 太郎',
      websiteUrl: 'https://example.com',
      language: 'ja-jp',
      imageUrl: 'https://example.com/art.jpg',
      categories: [
        { category: 'Society & Culture', subcategory: 'Documentary' },
        { category: 'Technology', subcategory: '' },
      ],
      explicit: false,
      showType: 'serial',
      copyright: '© 2026 Example',
      ownerName: 'Example Owner',
      ownerEmail: 'owner@example.com',
      complete: false,
      locked: true,
      feedUrl: 'https://feeds.example.com/show.xml',
      podcastGuid: 'ead4c236-bf58-58c6-a2c6-a6b28d128cb6',
      funding: [{ url: 'https://example.com/support', label: '応援する' }],
    });
  });

  it('maps items, falls back to the enclosure URL as guid, and drops unusable items', () => {
    const { items } = parsePodcastFeed(FEED, 'https://example.com/fetched.xml');
    expect(items.map((i) => i.guid)).toEqual([
      'ep-2',
      'trailer',
      'https://cdn.example.com/old.mp3',
    ]);
    expect(items[0]).toEqual({
      guid: 'ep-2',
      title: '第2回',
      description: '<p>二回目</p>',
      publishedAt: Date.UTC(2026, 8, 1, 0, 0, 0),
      enclosureUrl: 'https://cdn.example.com/2.mp3',
      enclosureLength: 12345678,
      enclosureType: 'audio/mpeg',
      durationSmp: 3723 * 48000,
      episodeNumber: 2,
      season: 1,
      episodeType: 'full',
      explicit: true,
      websiteUrl: 'https://example.com/2',
      imageUrl: 'https://example.com/2.jpg',
    });
    expect(items[1]).toMatchObject({
      description: '本文は content:encoded だけ',
      enclosureLength: null,
      durationSmp: 90 * 48000,
      episodeNumber: null,
      episodeType: 'trailer',
      explicit: null,
      websiteUrl: '',
      imageUrl: null,
    });
  });

  it('resolves namespaces declared with unusual prefixes', () => {
    const xml = `<rss xmlns:it="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
      <title>t</title><it:author>A</it:author><it:type>serial</it:type>
    </channel></rss>`;
    const { show } = parsePodcastFeed(xml, 'https://example.com/f');
    expect(show.author).toBe('A');
    expect(show.showType).toBe('serial');
  });

  it('prefers itunes:new-feed-url, then the fetched URL when no self link exists', () => {
    const moved = `<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
      <itunes:new-feed-url>https://new.example.com/feed</itunes:new-feed-url>
    </channel></rss>`;
    expect(parsePodcastFeed(moved, 'https://old.example.com/f').show.feedUrl).toBe(
      'https://new.example.com/feed',
    );
    const bare =
      '<rss><channel><title>x</title><image><url>https://e.com/i.png</url></image></channel></rss>';
    const { show } = parsePodcastFeed(bare, 'https://example.com/f');
    expect(show.feedUrl).toBe('https://example.com/f');
    expect(show.imageUrl).toBe('https://e.com/i.png');
    expect(show.explicit).toBe(false);
    expect(show.showType).toBe('episodic');
  });

  it('E-8: drops URLs that are not http(s)', () => {
    const xml = `<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel>
      <title>t</title><link>javascript:alert(1)</link>
      <itunes:image href="data:image/png;base64,AAAA"/>
      <podcast:funding url="javascript:x">x</podcast:funding>
      <item><guid>g</guid><link>file:///etc/passwd</link><itunes:image href="ftp://e.com/a.png"/>
        <enclosure url="javascript:y" length="1" type="audio/mpeg"/></item>
    </channel></rss>`;
    const { show, items } = parsePodcastFeed(xml, 'https://example.com/f');
    expect(show.websiteUrl).toBe('');
    expect(show.imageUrl).toBeNull();
    expect(show.funding).toEqual([]);
    expect(items[0]).toMatchObject({ websiteUrl: '', imageUrl: null, enclosureUrl: null });
  });

  it('rejects documents that are not RSS feeds', () => {
    const code = (xml: string) => {
      try {
        parsePodcastFeed(xml, 'https://example.com/');
      } catch (e) {
        return e instanceof AppError ? e.code : 'other';
      }
      return 'none';
    };
    expect(code('<html><body>hi</body></html>')).toBe('import_not_a_feed');
    expect(code('<rss></rss>')).toBe('import_not_a_feed');
    expect(code('<!doctype html><html><body>broken')).toBe('import_not_a_feed');
    expect(code('{"json": true}')).toBe('import_not_a_feed');
  });
});

describe('parseRfc2822Date', () => {
  it('reads RFC 2822 dates with numeric and named zones', () => {
    expect(parseRfc2822Date('Tue, 01 Sep 2026 09:00:00 +0900')).toBe(Date.UTC(2026, 8, 1, 0));
    expect(parseRfc2822Date('01 Sep 2026 09:00 GMT')).toBe(Date.UTC(2026, 8, 1, 9));
    expect(parseRfc2822Date('Tue, 1 Sep 2026 09:00:00 JST')).toBe(Date.UTC(2026, 8, 1, 0));
    expect(parseRfc2822Date('Tue, 01 Sep 2026 04:00:00 EST')).toBe(Date.UTC(2026, 8, 1, 9));
    expect(parseRfc2822Date('Tuesday, 01 September 2026 09:00:00 -05:30')).toBe(
      Date.UTC(2026, 8, 1, 14, 30),
    );
    expect(parseRfc2822Date('Tue, 01 Sep 26 09:00:00 GMT')).toBe(Date.UTC(2026, 8, 1, 9));
  });

  it('accepts ISO 8601 and rejects garbage', () => {
    expect(parseRfc2822Date('2026-09-01T00:00:00Z')).toBe(Date.UTC(2026, 8, 1));
    expect(parseRfc2822Date('')).toBeNull();
    expect(parseRfc2822Date('yesterday')).toBeNull();
    expect(parseRfc2822Date('Tue, 01 Foo 2026 09:00:00 GMT')).toBeNull();
    expect(parseRfc2822Date('Tue, 01 Sep 2026 25:00:00 GMT')).toBeNull();
  });
});

describe('htmlToPlainText', () => {
  it('turns paragraphs, breaks and list items into lines', () => {
    expect(htmlToPlainText('<p>a</p><p>b<br/>c</p><ul><li>x</li><li>y</li></ul>')).toBe(
      'a\nb\nc\n・x\n・y',
    );
    expect(htmlToPlainText('A &amp; B&nbsp;C')).toBe('A & B C');
    expect(htmlToPlainText('  plain  ')).toBe('plain');
    expect(htmlToPlainText('<p>a</p>\n\n\n\n<p>b</p>')).toBe('a\n\nb');
  });
});

describe('E-6: character encoding', () => {
  it('reads the encoding from the XML declaration', () => {
    expect(declaredEncoding('<?xml version="1.0" encoding="UTF-8"?><rss/>')).toBe('UTF-8');
    expect(declaredEncoding("\uFEFF<?xml version='1.0' encoding='Shift_JIS'?>")).toBe('Shift_JIS');
    expect(declaredEncoding('<?xml version="1.0"?><rss/>')).toBeNull();
    expect(declaredEncoding('<rss/>')).toBeNull();
  });

  it('refuses feeds that declare a non UTF-8 encoding instead of garbling them', () => {
    const code = (xml: string) => {
      try {
        parsePodcastFeed(xml, 'https://example.com/');
        return 'ok';
      } catch (e) {
        return e instanceof AppError ? `${e.code}:${String(e.params.encoding ?? '')}` : 'other';
      }
    };
    const body = '<rss><channel><title>t</title></channel></rss>';
    expect(code(`<?xml version="1.0" encoding="Shift_JIS"?>${body}`)).toBe(
      'import_unsupported_encoding:Shift_JIS',
    );
    expect(code(`<?xml version="1.0" encoding="EUC-JP"?>${body}`)).toBe(
      'import_unsupported_encoding:EUC-JP',
    );
    expect(code(`<?xml version="1.0" encoding="utf-8"?>${body}`)).toBe('ok');
    expect(code(`<?xml version="1.0" encoding="US-ASCII"?>${body}`)).toBe('ok');
    expect(code(body)).toBe('ok');
  });
});

describe('E-10: size limits', () => {
  it('clips without splitting a surrogate pair', () => {
    expect(clip('abc', 5)).toBe('abc');
    expect(clip('abcdef', 3)).toBe('abc');
    expect(clip('ab🎙c', 3)).toBe('ab');
    expect(clip('ab🎙c', 4)).toBe('ab🎙');
  });

  it('clips long text, drops overlong URLs and guids, and caps the number of items', () => {
    const longTitle = 'あ'.repeat(FEED_LIMITS.line + 10);
    const longText = 'x'.repeat(FEED_LIMITS.text + 10);
    const longUrl = `https://e.com/${'a'.repeat(FEED_LIMITS.url)}`;
    const items = Array.from(
      { length: FEED_LIMITS.items + 5 },
      (_, i) => `<item><guid>g${i}</guid></item>`,
    ).join('');
    const xml = `<rss><channel><title>${longTitle}</title><description>${longText}</description>
      <link>${longUrl}</link>
      <item><guid>${'g'.repeat(FEED_LIMITS.url + 1)}</guid></item>${items}</channel></rss>`;
    const feed = parsePodcastFeed(xml, 'https://example.com/f');
    expect(feed.show.title).toHaveLength(FEED_LIMITS.line);
    expect(feed.show.description).toHaveLength(FEED_LIMITS.text);
    expect(feed.show.websiteUrl).toBe('');
    expect(feed.items).toHaveLength(FEED_LIMITS.items);
    expect(feed.items[0]!.guid).toBe('g0');
  });
});
