import {
  normalizeLanguage,
  parseEpisodeType,
  parseExplicit,
  parseItunesDuration,
  parsePositiveInt,
  parseShowType,
  parseYes,
} from '../feed';

describe('podcast feed values', () => {
  it('parses itunes:explicit including legacy values', () => {
    expect(parseExplicit('true')).toBe(true);
    expect(parseExplicit(' TRUE ')).toBe(true);
    expect(parseExplicit('yes')).toBe(true);
    expect(parseExplicit('explicit')).toBe(true);
    expect(parseExplicit('false')).toBe(false);
    expect(parseExplicit('no')).toBe(false);
    expect(parseExplicit('clean')).toBe(false);
    expect(parseExplicit('')).toBeNull();
    expect(parseExplicit(undefined)).toBeNull();
    expect(parseExplicit('maybe')).toBeNull();
  });

  it('defaults itunes:type to episodic', () => {
    expect(parseShowType('serial')).toBe('serial');
    expect(parseShowType('Serial')).toBe('serial');
    expect(parseShowType('episodic')).toBe('episodic');
    expect(parseShowType('')).toBe('episodic');
    expect(parseShowType('weekly')).toBe('episodic');
  });

  it('defaults itunes:episodeType to full', () => {
    expect(parseEpisodeType('trailer')).toBe('trailer');
    expect(parseEpisodeType('Bonus')).toBe('bonus');
    expect(parseEpisodeType('full')).toBe('full');
    expect(parseEpisodeType(null)).toBe('full');
    expect(parseEpisodeType('teaser')).toBe('full');
  });

  it('treats only yes as true for itunes:complete', () => {
    expect(parseYes('yes')).toBe(true);
    expect(parseYes('Yes')).toBe(true);
    expect(parseYes('no')).toBe(false);
    expect(parseYes('true')).toBe(false);
    expect(parseYes(undefined)).toBe(false);
  });

  it('accepts only non-zero integers for episode and season', () => {
    expect(parsePositiveInt('12')).toBe(12);
    expect(parsePositiveInt(' 3 ')).toBe(3);
    expect(parsePositiveInt('0')).toBeNull();
    expect(parsePositiveInt('-1')).toBeNull();
    expect(parsePositiveInt('1.5')).toBeNull();
    expect(parsePositiveInt('abc')).toBeNull();
    expect(parsePositiveInt('')).toBeNull();
    expect(parsePositiveInt('99999999999999999999')).toBeNull();
  });

  it('parses itunes:duration in seconds and clock forms into samples', () => {
    expect(parseItunesDuration('90')).toBe(90 * 48000);
    expect(parseItunesDuration('1.5')).toBe(72000);
    expect(parseItunesDuration('01:30')).toBe(90 * 48000);
    expect(parseItunesDuration('1:02:03')).toBe(3723 * 48000);
    expect(parseItunesDuration('')).toBeNull();
    expect(parseItunesDuration('1:60')).toBeNull();
    expect(parseItunesDuration('1:2:3:4')).toBeNull();
    expect(parseItunesDuration('1.5:00')).toBeNull();
    expect(parseItunesDuration('abc')).toBeNull();
  });

  it('normalizes language codes to lower case', () => {
    expect(normalizeLanguage(' ja-JP ')).toBe('ja-jp');
    expect(normalizeLanguage(undefined)).toBe('');
  });
});
