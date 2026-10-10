import { APPLE_CATEGORIES, SHOW_LANGUAGES } from '@/domain/podcast/categories';

import { en } from '../en';
import { ja } from '../ja';

describe('番組の分類と言語の表示名（Issue #259）', () => {
  it('Apple の分類はすべて日本語名を持つ（英語は分類名そのもの）', () => {
    const names = APPLE_CATEGORIES.flatMap((g) => [g.name, ...g.subcategories]);
    const missing = names.filter((n) => ja.showSettings.categoryName(n) === n);
    expect(missing).toEqual([]);
    for (const n of names) expect(en.showSettings.categoryName(n)).toBe(n);
  });

  it('一覧に無い分類は元の名前のまま出す', () => {
    expect(ja.showSettings.categoryName('Games & Hobbies')).toBe('Games & Hobbies');
  });

  it('選べる言語はすべて ja / en の名前を持つ。一覧外はコードのまま', () => {
    for (const code of SHOW_LANGUAGES) {
      expect(ja.showSettings.languageName(code)).not.toBe(code);
      expect(en.showSettings.languageName(code)).not.toBe(code);
    }
    expect(ja.showSettings.languageName('id')).toBe('id');
  });
});
