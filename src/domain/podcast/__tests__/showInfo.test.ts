import { categoryNames, primaryLanguage, showWebsite } from '../showInfo';

describe('showWebsite', () => {
  it('http / https の URL を開ける形にし、短い表示名を付ける', () => {
    expect(showWebsite('https://www.Example.com/show/')).toEqual({
      href: 'https://www.Example.com/show/',
      label: 'example.com/show',
    });
    expect(showWebsite('http://radio.example.jp')).toEqual({
      href: 'http://radio.example.jp',
      label: 'radio.example.jp',
    });
  });

  it('クエリとフラグメントは表示名に出さない', () => {
    expect(showWebsite('https://example.com/a?utm=1#top')?.label).toBe('example.com/a');
  });

  it('スキームが無ければ https を補う', () => {
    expect(showWebsite('  example.com/podcast ')).toEqual({
      href: 'https://example.com/podcast',
      label: 'example.com/podcast',
    });
  });

  it('空・空白入り・http(s) 以外・ホスト名でないものは開かない', () => {
    for (const v of [
      '',
      '   ',
      'javascript:alert(1)',
      'mailto:a@example.com',
      'ftp://example.com',
      'spotify:show:abc',
      'https://exa mple.com',
      'https://user@example.com',
      'https://localhost',
      'https://',
    ]) {
      expect(showWebsite(v)).toBeNull();
    }
  });
});

describe('categoryNames', () => {
  it('主と副を出現順に平らにし、同じ名前は 1 回だけ', () => {
    expect(
      categoryNames([
        { category: 'Society & Culture', subcategory: 'Personal Journals' },
        { category: 'Society & Culture', subcategory: 'Philosophy' },
        { category: 'Arts', subcategory: '' },
      ]),
    ).toEqual(['Society & Culture', 'Personal Journals', 'Philosophy', 'Arts']);
  });

  it('空の並びは空', () => {
    expect(categoryNames([])).toEqual([]);
  });

  it('前後の空白を落とし、空の名前は出さない', () => {
    expect(categoryNames([{ category: ' Comedy ', subcategory: ' ' }])).toEqual(['Comedy']);
  });
});

describe('primaryLanguage', () => {
  it('地域の部分を落として小文字にする', () => {
    expect(primaryLanguage('ja')).toBe('ja');
    expect(primaryLanguage('en-US')).toBe('en');
    expect(primaryLanguage('zh_TW')).toBe('zh');
    expect(primaryLanguage(' ')).toBe('');
  });
});
