/**
 * Podcast RSS（RSS 2.0 + iTunes + Podcast 名前空間）を `PodcastFeed` に変換する（Issue #101）。
 *
 * 値の正規化は `feed.ts`、XML の字句解析は `xml.ts`。ここは「どの要素から何を取るか」だけを持つ。
 * 規格: PSP-1 https://github.com/Podcast-Standards-Project/PSP-1-Podcast-RSS-Specification
 */
import { AppError } from '../errors';
import {
  normalizeLanguage,
  parseEpisodeType,
  parseExplicit,
  parseItunesDuration,
  parsePositiveInt,
  parseShowType,
  parseYes,
  type PodcastCategory,
  type PodcastFeed,
  type PodcastFeedItem,
  type PodcastFunding,
} from './feed';
import { decodeEntities, parseXml, XmlParseError, type XmlElement } from './xml';

/** 名前空間 URI → この実装で使う接頭辞。フィードが別の接頭辞で宣言していても同じ要素として扱う。 */
const KNOWN_NAMESPACES: Record<string, string> = {
  'www.itunes.com/dtds/podcast-1.0.dtd': 'itunes',
  'podcastindex.org/namespace/1.0': 'podcast',
  'github.com/podcastindex-org/podcast-namespace/blob/main/docs/1.0.md': 'podcast',
  'www.w3.org/2005/atom': 'atom',
  'purl.org/rss/1.0/modules/content/': 'content',
};

function canonicalUri(uri: string): string {
  return uri
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '');
}

/** 接頭辞の読み替え表。宣言の無い慣用の接頭辞（itunes: 等）はそのまま通す。 */
function prefixMap(...els: XmlElement[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const el of els) {
    for (const [k, v] of Object.entries(el.attrs)) {
      if (!k.startsWith('xmlns:')) continue;
      const known = KNOWN_NAMESPACES[canonicalUri(v)];
      if (known) map.set(k.slice(6), known);
    }
  }
  return map;
}

function keyOf(el: XmlElement, prefixes: Map<string, string>): string {
  const c = el.name.indexOf(':');
  if (c === -1) return el.name;
  const p = el.name.slice(0, c);
  return `${prefixes.get(p) ?? p}:${el.name.slice(c + 1)}`;
}

class View {
  constructor(
    readonly el: XmlElement,
    private readonly prefixes: Map<string, string>,
  ) {}

  all(key: string): View[] {
    return this.el.children
      .filter((c) => keyOf(c, this.prefixes) === key)
      .map((c) => new View(c, this.prefixes));
  }

  one(key: string): View | null {
    return this.all(key)[0] ?? null;
  }

  /** 直下の要素の本文（前後の空白を落とす）。無ければ空文字。 */
  text(key: string): string {
    return this.one(key)?.el.text.trim() ?? '';
  }

  attr(key: string, name: string): string {
    return this.one(key)?.el.attrs[name]?.trim() ?? '';
  }
}

function nonEmpty(...values: string[]): string {
  return values.find((v) => v !== '') ?? '';
}

/**
 * 外から来た URL は http(s) だけを残す（`javascript:` などを保存しない。docs/podcast-import-cases.md E-8）。
 */
export function safeUrl(v: string): string {
  const s = v.trim();
  return /^https?:\/\/[^\s/]+/i.test(s) ? s : '';
}

function orNull(v: string): string | null {
  return v === '' ? null : v;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** RFC 822 の時間帯名。JST は規格外だが国内のフィードで使われる。 */
const ZONES: Record<string, number> = {
  ut: 0,
  utc: 0,
  gmt: 0,
  z: 0,
  est: -5,
  edt: -4,
  cst: -6,
  cdt: -5,
  mst: -7,
  mdt: -6,
  pst: -8,
  pdt: -7,
  jst: 9,
};

/**
 * `pubDate`（RFC 2822）を Unix ms にする。ISO 8601 も受け付ける。解釈できなければ null。
 * `Date.parse` の RFC 2822 対応は JS エンジン次第なので自前で読む。
 */
export function parseRfc2822Date(v: string | null | undefined): number | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  const m =
    /^(?:[A-Za-z]{3,9},?\s*)?(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{2}:?\d{2}|[A-Za-z]{1,5})?\s*$/.exec(
      s,
    );
  if (m) {
    const month = MONTHS.indexOf(m[2]!.toLowerCase());
    if (month === -1) return null;
    let year = Number(m[3]);
    if (m[3]!.length === 2) year += year < 50 ? 2000 : 1900;
    const day = Number(m[1]);
    const hh = Number(m[4]);
    const mm = Number(m[5]);
    const ss = m[6] ? Number(m[6]) : 0;
    if (day < 1 || day > 31 || hh > 23 || mm > 59 || ss > 60) return null;
    let offsetMin = 0;
    const zone = m[7];
    if (zone) {
      if (/^[+-]/.test(zone)) {
        const digits = zone.replace(':', '');
        const sign = digits[0] === '-' ? -1 : 1;
        offsetMin = sign * (Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5)));
      } else {
        offsetMin = (ZONES[zone.toLowerCase()] ?? 0) * 60;
      }
    }
    return Date.UTC(year, month, day, hh, mm, ss) - offsetMin * 60_000;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * 概要の HTML を編集用のプレーンテキストにする。段落・改行・項目は改行に、その他のタグは落とす。
 * 番組の概要（`shows.description`）はユーザーが書き換える欄なので、タグを残さない。
 */
export function htmlToPlainText(html: string): string {
  if (!/[<&]/.test(html)) return html.trim();
  const text = html
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '・')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ');
  return decodeEntities(text)
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseCategories(channel: View): PodcastCategory[] {
  const out: PodcastCategory[] = [];
  const seen = new Set<string>();
  for (const c of channel.all('itunes:category')) {
    const category = c.el.attrs.text?.trim() ?? '';
    if (!category) continue;
    const subs = c.all('itunes:category').map((s) => s.el.attrs.text?.trim() ?? '');
    for (const subcategory of subs.length ? subs.filter(Boolean) : ['']) {
      const k = `${category}\u0000${subcategory}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ category, subcategory });
    }
  }
  return out;
}

function parseFunding(channel: View): PodcastFunding[] {
  return channel
    .all('podcast:funding')
    .map((f) => ({ url: safeUrl(f.el.attrs.url ?? ''), label: f.el.text.trim() }))
    .filter((f) => f.url !== '');
}

function parseLength(v: string): number | null {
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

function parseItem(item: View): PodcastFeedItem | null {
  const enclosureUrl = orNull(safeUrl(item.attr('enclosure', 'url')));
  // guid の無い古いフィードは、多くのアプリと同じく音声の URL を guid の代わりにする。
  // どちらも無ければ再取り込みで突き合わせられないので取り込まない。
  const guid = nonEmpty(item.text('guid'), enclosureUrl ?? '');
  if (!guid) return null;
  return {
    guid,
    title: nonEmpty(item.text('title'), item.text('itunes:title')),
    // 回の概要は HTML のまま持つ（乗り換え先の RSS にそのまま載せるため。表示時に扱う）
    description: nonEmpty(
      item.text('description'),
      item.text('content:encoded'),
      item.text('itunes:summary'),
    ),
    publishedAt: parseRfc2822Date(item.text('pubDate')),
    enclosureUrl,
    enclosureLength: parseLength(item.attr('enclosure', 'length')),
    enclosureType: orNull(item.attr('enclosure', 'type')),
    durationSmp: parseItunesDuration(item.text('itunes:duration')),
    episodeNumber: parsePositiveInt(item.text('itunes:episode')),
    season: parsePositiveInt(item.text('itunes:season')),
    episodeType: parseEpisodeType(item.text('itunes:episodeType')),
    explicit: parseExplicit(item.text('itunes:explicit')),
    websiteUrl: safeUrl(item.text('link')),
    imageUrl: orNull(safeUrl(item.attr('itunes:image', 'href'))),
  };
}

/**
 * 保存する値の上限（docs/podcast-import-cases.md E-10）【仮説: 値】。
 * PSP-1 の「概要 4,000 バイト」は RSS を作る側の決まりで、実際のフィードはこれを超えることが多い。
 * 切り詰めると乗り換え先の RSS に載せる内容が欠けるので、端末とメモリを守れる程度に大きく取る。
 */
export const FEED_LIMITS = {
  /** 番組名・回の題名・著者などの 1 行の文字列 */
  line: 1_000,
  /** 番組・回の概要 */
  text: 100_000,
  /** URL と guid。超えたら切り詰めずに捨てる（壊れた URL や別の guid を作らない） */
  url: 2_048,
  /** 回の数。RSS の先頭（通常は新しい順）から数える */
  items: 10_000,
} as const;

/** 先頭から `max` 文字（UTF-16）で切る。サロゲートペアの途中では切らない。 */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const code = s.charCodeAt(max - 1);
  return s.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

function clipUrl(s: string): string {
  return s.length > FEED_LIMITS.url ? '' : s;
}

function clipUrlOrNull(s: string | null): string | null {
  return s === null || s.length > FEED_LIMITS.url ? null : s;
}

function clampItem(i: PodcastFeedItem): PodcastFeedItem {
  return {
    ...i,
    title: clip(i.title, FEED_LIMITS.line),
    description: clip(i.description, FEED_LIMITS.text),
    enclosureUrl: clipUrlOrNull(i.enclosureUrl),
    enclosureType: i.enclosureType === null ? null : clip(i.enclosureType, FEED_LIMITS.line),
    websiteUrl: clipUrl(i.websiteUrl),
    imageUrl: clipUrlOrNull(i.imageUrl),
  };
}

function clampShow(s: PodcastFeed['show']): PodcastFeed['show'] {
  const line = (v: string) => clip(v, FEED_LIMITS.line);
  return {
    ...s,
    title: line(s.title),
    description: clip(s.description, FEED_LIMITS.text),
    author: line(s.author),
    websiteUrl: clipUrl(s.websiteUrl),
    language: line(s.language),
    imageUrl: clipUrlOrNull(s.imageUrl),
    categories: s.categories.map((c) => ({
      category: line(c.category),
      subcategory: line(c.subcategory),
    })),
    copyright: line(s.copyright),
    ownerName: line(s.ownerName),
    ownerEmail: line(s.ownerEmail),
    feedUrl: clipUrl(s.feedUrl),
    podcastGuid: s.podcastGuid === null ? null : clipUrlOrNull(s.podcastGuid),
    funding: s.funding
      .map((f) => ({ url: clipUrl(f.url), label: line(f.label) }))
      .filter((f) => f.url !== ''),
  };
}

const UTF8_LABELS = new Set(['utf-8', 'utf8', 'us-ascii', 'ascii']);

/**
 * XML 宣言の `encoding`（無ければ null）。UTF-8 以外は、文字化けさせずに取り込みを止めるために使う
 * （docs/podcast-import-cases.md E-6）。
 */
export function declaredEncoding(xml: string): string | null {
  const head = xml.slice(0, 300);
  const m = /^\uFEFF?\s*<\?xml[^>]*?\bencoding\s*=\s*["']([^"']+)["']/i.exec(head);
  return m ? m[1]!.trim() : null;
}

/**
 * RSS の本文を `PodcastFeed` にする。`fetchedUrl` は取得に使った URL（最終的なリダイレクト先）。
 * RSS でなければ `AppError('import_not_a_feed')`。
 */
export function parsePodcastFeed(xml: string, fetchedUrl: string): PodcastFeed {
  const encoding = declaredEncoding(xml);
  if (encoding && !UTF8_LABELS.has(encoding.toLowerCase())) {
    throw new AppError('import_unsupported_encoding', { encoding });
  }
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch (e) {
    if (e instanceof XmlParseError) throw new AppError('import_not_a_feed', {}, e);
    throw e;
  }
  const channelEl = root.name === 'rss' ? root.children.find((c) => c.name === 'channel') : null;
  if (!channelEl) throw new AppError('import_not_a_feed');
  const prefixes = prefixMap(root, channelEl);
  const channel = new View(channelEl, prefixes);

  const selfLink = channel
    .all('atom:link')
    .find((l) => (l.el.attrs.rel ?? '').trim().toLowerCase() === 'self')
    ?.el.attrs.href?.trim();
  const owner = channel.one('itunes:owner');

  const items: PodcastFeedItem[] = [];
  const seen = new Set<string>();
  for (const it of channel.all('item')) {
    if (items.length >= FEED_LIMITS.items) break;
    const parsed = parseItem(it);
    // 同じ guid が 2 回出るフィードは、先に出た（通常は新しい）方を採る。長すぎる guid は捨てる（E-10）
    if (!parsed || parsed.guid.length > FEED_LIMITS.url || seen.has(parsed.guid)) continue;
    seen.add(parsed.guid);
    items.push(clampItem(parsed));
  }

  return {
    show: clampShow({
      title: nonEmpty(channel.text('title'), channel.text('itunes:title')),
      description: htmlToPlainText(
        nonEmpty(channel.text('description'), channel.text('itunes:summary')),
      ),
      author: channel.text('itunes:author'),
      websiteUrl: safeUrl(channel.text('link')),
      language: normalizeLanguage(channel.text('language')),
      imageUrl: orNull(
        nonEmpty(
          safeUrl(channel.attr('itunes:image', 'href')),
          safeUrl(channel.one('image')?.text('url') ?? ''),
        ),
      ),
      categories: parseCategories(channel),
      explicit: parseExplicit(channel.text('itunes:explicit')) ?? false,
      showType: parseShowType(channel.text('itunes:type')),
      copyright: channel.text('copyright'),
      ownerName: owner?.text('itunes:name') ?? '',
      ownerEmail: owner?.text('itunes:email') ?? '',
      complete: parseYes(channel.text('itunes:complete')),
      locked: parseYes(channel.text('podcast:locked')),
      // 移転を宣言していればそれが正、次に自己申告の URL、最後に実際に取れた URL
      feedUrl: nonEmpty(
        safeUrl(channel.text('itunes:new-feed-url')),
        safeUrl(selfLink ?? ''),
        fetchedUrl,
      ),
      podcastGuid: orNull(channel.text('podcast:guid')),
      funding: parseFunding(channel),
    }),
    items,
  };
}
