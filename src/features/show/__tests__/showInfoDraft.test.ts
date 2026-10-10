import type { ShowRow } from '@/infra/db/repositories/showsRepo';
import type { ShowInfo } from '@/services/shows/ShowService';

import { draftFromInfo, patchFromDraft, patchFromInfo } from '../showInfoDraft';

const info: ShowInfo = {
  show: {
    name: '夜更けのラジオ',
    description: '眠れない夜に',
    author: 'nemoto',
    website_url: 'https://example.com',
    language: 'en-us',
    explicit: 0,
  } as ShowRow,
  categories: [
    { category: 'Society & Culture', subcategory: 'Personal Journals' },
    { category: 'Arts', subcategory: 'Books' },
  ],
};

describe('showInfoDraft', () => {
  it('番組情報から入力中の値を作る。主カテゴリーは先頭の行', () => {
    expect(draftFromInfo(info)).toEqual({
      name: '夜更けのラジオ',
      description: '眠れない夜に',
      author: 'nemoto',
      websiteUrl: 'https://example.com',
      language: 'en-us',
      explicit: false,
      primary: { category: 'Society & Culture', subcategory: 'Personal Journals' },
    });
  });

  it('何も変えなければ書かない（地域つきの言語もそのまま）', () => {
    expect(patchFromDraft(draftFromInfo(info), info, '既定')).toBeNull();
  });

  it('前後の空白だけの変更は変更とみなさない', () => {
    const d = {
      ...draftFromInfo(info),
      name: ' 夜更けのラジオ ',
      websiteUrl: ' https://example.com ',
    };
    expect(patchFromDraft(d, info, '既定')).toBeNull();
  });

  it('言語と explicit を書き、カテゴリーは元のまま渡す', () => {
    const d = { ...draftFromInfo(info), language: 'ja', explicit: true };
    expect(patchFromDraft(d, info, '既定')).toMatchObject({
      language: 'ja',
      explicit: true,
      categories: info.categories,
    });
  });

  it('主カテゴリーを変えたら、副のカテゴリーを残して並びを作り直す', () => {
    const d = { ...draftFromInfo(info), primary: { category: 'Comedy', subcategory: '' } };
    expect(patchFromDraft(d, info, '既定')?.categories).toEqual([
      { category: 'Comedy', subcategory: '' },
      { category: 'Arts', subcategory: 'Books' },
    ]);
  });

  it('番組名が空なら既定の名前にする', () => {
    const d = { ...draftFromInfo(info), name: '  ' };
    expect(patchFromDraft(d, info, '既定')?.name).toBe('既定');
  });

  it('取り消し用の値は今の番組情報そのもの', () => {
    expect(patchFromInfo(info)).toEqual({
      name: '夜更けのラジオ',
      description: '眠れない夜に',
      author: 'nemoto',
      websiteUrl: 'https://example.com',
      language: 'en-us',
      explicit: false,
      categories: info.categories,
    });
  });
});
