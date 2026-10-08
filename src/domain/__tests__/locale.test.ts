import { FALLBACK_LOCALE, isLocale, LOCALES, resolveLocale } from '../locale';

describe('resolveLocale', () => {
  it('設定が固定なら端末ロケールを無視する', () => {
    expect(resolveLocale('ja', ['en-US'])).toBe('ja');
    expect(resolveLocale('en', ['ja-JP'])).toBe('en');
  });

  it("'system' なら端末の優先順で最初に対応しているものを採る", () => {
    expect(resolveLocale('system', ['ja-JP', 'en-US'])).toBe('ja');
    expect(resolveLocale('system', ['en-US', 'ja-JP'])).toBe('en');
    expect(resolveLocale('system', ['fr-FR', 'ja'])).toBe('ja');
  });

  it('地域・大文字・アンダースコア付きのタグを言語コードに正規化する', () => {
    expect(resolveLocale('system', ['ja-JP'])).toBe('ja');
    expect(resolveLocale('system', ['ja_JP'])).toBe('ja');
    expect(resolveLocale('system', ['JA'])).toBe('ja');
    expect(resolveLocale('system', ['en-GB'])).toBe('en');
  });

  it('未対応の言語しか無ければフォールバックする', () => {
    expect(resolveLocale('system', ['fr-FR', 'de-DE'])).toBe(FALLBACK_LOCALE);
    expect(resolveLocale('system', [])).toBe(FALLBACK_LOCALE);
    expect(resolveLocale('system', [null, undefined, ''])).toBe(FALLBACK_LOCALE);
  });

  it('LOCALES のすべてが isLocale を通る', () => {
    for (const locale of LOCALES) expect(isLocale(locale)).toBe(true);
    expect(isLocale('fr')).toBe(false);
  });
});
