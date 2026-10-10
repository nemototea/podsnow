import {
  APPLE_CATEGORIES,
  primaryCategory,
  setPrimaryCategory,
  SHOW_LANGUAGES,
  subcategoriesOf,
} from '../categories';

describe('APPLE_CATEGORIES', () => {
  it('主の名前と副の名前がすべて重ならない（表示名の辞書を 1 つで引けるように）', () => {
    const names = APPLE_CATEGORIES.flatMap((g) => [g.name, ...g.subcategories]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('副の一覧を主から引ける。一覧に無い主は空', () => {
    expect(subcategoriesOf('Society & Culture')).toContain('Personal Journals');
    expect(subcategoriesOf('Technology')).toEqual([]);
    expect(subcategoriesOf('Games & Hobbies')).toEqual([]);
  });
});

describe('primaryCategory', () => {
  it('先頭の行が主。空なら主も副も空', () => {
    expect(primaryCategory([{ category: 'Arts', subcategory: 'Books' }])).toEqual({
      category: 'Arts',
      subcategory: 'Books',
    });
    expect(primaryCategory([])).toEqual({ category: '', subcategory: '' });
  });
});

describe('setPrimaryCategory', () => {
  const imported = [
    { category: 'Society & Culture', subcategory: 'Personal Journals' },
    { category: 'Society & Culture', subcategory: 'Philosophy' },
    { category: 'Arts', subcategory: 'Books' },
  ];

  it('主の行をまとめて 1 行に置き換え、副のカテゴリーは後ろに残す', () => {
    expect(setPrimaryCategory(imported, { category: 'Comedy', subcategory: 'Improv' })).toEqual([
      { category: 'Comedy', subcategory: 'Improv' },
      { category: 'Arts', subcategory: 'Books' },
    ]);
  });

  it('主の副だけを変える', () => {
    expect(
      setPrimaryCategory(imported, { category: 'Society & Culture', subcategory: 'Documentary' }),
    ).toEqual([
      { category: 'Society & Culture', subcategory: 'Documentary' },
      { category: 'Arts', subcategory: 'Books' },
    ]);
  });

  it('副にあった分類を主にしたら、副からは消す', () => {
    expect(setPrimaryCategory(imported, { category: 'Arts', subcategory: '' })).toEqual([
      { category: 'Arts', subcategory: '' },
    ]);
  });

  it('空の主を渡すと主を外し、残りの先頭が主になる', () => {
    expect(setPrimaryCategory(imported, { category: '', subcategory: '' })).toEqual([
      { category: 'Arts', subcategory: 'Books' },
    ]);
  });

  it('空の並びに主を足す', () => {
    expect(setPrimaryCategory([], { category: 'News', subcategory: '' })).toEqual([
      { category: 'News', subcategory: '' },
    ]);
  });

  it('元の並びを書き換えない', () => {
    const rows = imported.map((r) => ({ ...r }));
    setPrimaryCategory(rows, { category: 'News', subcategory: '' });
    expect(rows).toEqual(imported);
  });
});

describe('SHOW_LANGUAGES', () => {
  it('小文字の 2 文字コードで、重ならない', () => {
    for (const code of SHOW_LANGUAGES) expect(code).toMatch(/^[a-z]{2}$/);
    expect(new Set(SHOW_LANGUAGES).size).toBe(SHOW_LANGUAGES.length);
  });
});
