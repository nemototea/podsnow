import { hasFamily, resolveFamily } from '../fonts';

// 書体は Figtree（欧文・数字）と Noto Sans JP（和文）。Issue #235、DESIGN_SYSTEM.md §4。
const IOS_LOADED = [
  'Figtree-Regular',
  'Figtree-Bold',
  'Figtree-Black',
  'NotoSansJP-Regular',
  'NotoSansJP-Bold',
];
const ANDROID_LOADED = ['Figtree', 'Noto Sans JP'];

describe('書体の解決', () => {
  it('iOS の PostScript 名でも Android のファミリー名でも、同梱の有無を判定できる', () => {
    for (const loaded of [IOS_LOADED, ANDROID_LOADED]) {
      expect(hasFamily(loaded, 'Figtree')).toBe(true);
      expect(hasFamily(loaded, 'Noto Sans JP')).toBe(true);
    }
  });

  it('UI の書体はロケールで選ぶ', () => {
    expect(resolveFamily('ui', 'ja', ANDROID_LOADED)).toBe('Noto Sans JP');
    expect(resolveFamily('ui', 'en', ANDROID_LOADED)).toBe('Figtree');
  });

  it('数値は日英とも Figtree の等幅数字を使う', () => {
    for (const loaded of [IOS_LOADED, ANDROID_LOADED]) {
      expect(resolveFamily('numeric', 'ja', loaded)).toBe('Figtree');
      expect(resolveFamily('numeric', 'en', loaded)).toBe('Figtree');
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
