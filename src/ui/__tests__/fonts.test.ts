import { hasFamily, resolveFamily } from '../fonts';

const IOS_LOADED = ['Manrope-Regular', 'Manrope-Medium', 'NotoSansJP-Regular', 'NotoSansJP-Bold'];
const ANDROID_LOADED = ['Manrope', 'Noto Sans JP'];

describe('書体の解決', () => {
  it('iOS の PostScript 名でも Android のファミリー名でも、同梱の有無を判定できる', () => {
    for (const loaded of [IOS_LOADED, ANDROID_LOADED]) {
      expect(hasFamily(loaded, 'Manrope')).toBe(true);
      expect(hasFamily(loaded, 'Noto Sans JP')).toBe(true);
    }
  });

  it('UI の書体はロケールで選ぶ', () => {
    expect(resolveFamily('ui', 'ja', ANDROID_LOADED)).toBe('Noto Sans JP');
    expect(resolveFamily('ui', 'en', ANDROID_LOADED)).toBe('Manrope');
  });

  it('数値は日英ともロゴと同系統の Manrope を使う', () => {
    for (const loaded of [IOS_LOADED, ANDROID_LOADED]) {
      expect(resolveFamily('numeric', 'ja', loaded)).toBe('Manrope');
      expect(resolveFamily('numeric', 'en', loaded)).toBe('Manrope');
    }
  });

  it('書体が登録されていなければ OS の書体へ退避する（起動と収録を書体に依存させない）', () => {
    expect(resolveFamily('ui', 'ja', [])).toBeUndefined();
    expect(resolveFamily('ui', 'en', ['NotoSansJP-Regular'])).toBeUndefined();
    expect(resolveFamily('numeric', 'en', [])).toBeUndefined();
    expect(resolveFamily('numeric', 'ja', [])).toBeUndefined();
    expect(resolveFamily('numeric', 'ja', ['NotoSansJP-Regular'])).toBe('Noto Sans JP');
  });
});
