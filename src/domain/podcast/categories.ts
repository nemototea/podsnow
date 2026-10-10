/**
 * Apple Podcasts の分類（`itunes:category`）と、番組の言語の選択肢（Issue #259、FR-SHOW-3a）。
 *
 * 分類名は英語の `text` 属性値そのもの（DB の `show_categories.category` / `subcategory` と同じ値）。
 * 表示名は UI 層（`src/i18n/`）で訳す。
 *
 * - `itunes:category` の値は Apple の分類から選ぶのが RSS 配信の事実上の標準
 *   【確認済み】PSP-1「selected from the list of Apple Podcasts categories」
 *   https://github.com/Podcast-Standards-Project/PSP-1-Podcast-RSS-Specification
 * - 一覧は 2019-08-09 の改定版（Enhanced Categories）。npm `podcast-categories@2.0.0`（Apple の Podcasts Connect の
 *   ヘルプを書き写したもの）と主・副とも一致することを確かめた（2026-10-10）。Apple のページは作業環境から開けなかった。
 *   あちらにだけある `Games & Hobbies`（副 `Other Games` など）は改定前の分類で `Leisure` に移った【仮説: 副の重なりからの推定】ので選ばせない
 *   （取り込んだ値はそのまま保存・表示する）。
 */
import type { PodcastCategory } from './feed';

export interface CategoryGroup {
  name: string;
  subcategories: readonly string[];
}

export const APPLE_CATEGORIES: readonly CategoryGroup[] = [
  {
    name: 'Arts',
    subcategories: [
      'Books',
      'Design',
      'Fashion & Beauty',
      'Food',
      'Performing Arts',
      'Visual Arts',
    ],
  },
  {
    name: 'Business',
    subcategories: [
      'Careers',
      'Entrepreneurship',
      'Investing',
      'Management',
      'Marketing',
      'Non-Profit',
    ],
  },
  { name: 'Comedy', subcategories: ['Comedy Interviews', 'Improv', 'Stand-Up'] },
  {
    name: 'Education',
    subcategories: ['Courses', 'How To', 'Language Learning', 'Self-Improvement'],
  },
  { name: 'Fiction', subcategories: ['Comedy Fiction', 'Drama', 'Science Fiction'] },
  { name: 'Government', subcategories: [] },
  { name: 'History', subcategories: [] },
  {
    name: 'Health & Fitness',
    subcategories: [
      'Alternative Health',
      'Fitness',
      'Medicine',
      'Mental Health',
      'Nutrition',
      'Sexuality',
    ],
  },
  {
    name: 'Kids & Family',
    subcategories: ['Education for Kids', 'Parenting', 'Pets & Animals', 'Stories for Kids'],
  },
  {
    name: 'Leisure',
    subcategories: [
      'Animation & Manga',
      'Automotive',
      'Aviation',
      'Crafts',
      'Games',
      'Hobbies',
      'Home & Garden',
      'Video Games',
    ],
  },
  { name: 'Music', subcategories: ['Music Commentary', 'Music History', 'Music Interviews'] },
  {
    name: 'News',
    subcategories: [
      'Business News',
      'Daily News',
      'Entertainment News',
      'News Commentary',
      'Politics',
      'Sports News',
      'Tech News',
    ],
  },
  {
    name: 'Religion & Spirituality',
    subcategories: [
      'Buddhism',
      'Christianity',
      'Hinduism',
      'Islam',
      'Judaism',
      'Religion',
      'Spirituality',
    ],
  },
  {
    name: 'Science',
    subcategories: [
      'Astronomy',
      'Chemistry',
      'Earth Sciences',
      'Life Sciences',
      'Mathematics',
      'Natural Sciences',
      'Nature',
      'Physics',
      'Social Sciences',
    ],
  },
  {
    name: 'Society & Culture',
    subcategories: [
      'Documentary',
      'Personal Journals',
      'Philosophy',
      'Places & Travel',
      'Relationships',
    ],
  },
  {
    name: 'Sports',
    subcategories: [
      'Baseball',
      'Basketball',
      'Cricket',
      'Fantasy Sports',
      'Football',
      'Golf',
      'Hockey',
      'Rugby',
      'Running',
      'Soccer',
      'Swimming',
      'Tennis',
      'Volleyball',
      'Wilderness',
      'Wrestling',
    ],
  },
  { name: 'Technology', subcategories: [] },
  { name: 'True Crime', subcategories: [] },
  {
    name: 'TV & Film',
    subcategories: ['After Shows', 'Film History', 'Film Interviews', 'Film Reviews', 'TV Reviews'],
  },
];

/** 分類の副の一覧。一覧に無い主（古い分類など）は空。 */
export function subcategoriesOf(category: string): readonly string[] {
  return APPLE_CATEGORIES.find((g) => g.name === category)?.subcategories ?? [];
}

/** 主カテゴリー（並びの先頭の行）。無ければ主も副も空。 */
export function primaryCategory(rows: readonly PodcastCategory[]): PodcastCategory {
  const first = rows[0];
  return first
    ? { category: first.category, subcategory: first.subcategory }
    : { category: '', subcategory: '' };
}

/**
 * 主カテゴリーを差し替えた並びを返す。主の行（先頭の行と同じ主を持つ行）を `next` 1 行に置き換え、
 * 残り（取り込んだ副のカテゴリー）はそのままの順で後ろに残す。`next` と同じ主の行は重ねない。
 * `next.category` が空なら主を外す（残りの先頭が新しい主になる）。
 */
export function setPrimaryCategory(
  rows: readonly PodcastCategory[],
  next: PodcastCategory,
): PodcastCategory[] {
  const old = rows[0]?.category;
  const rest = rows.filter((r) => r.category !== old && r.category !== next.category);
  return next.category
    ? [{ category: next.category, subcategory: next.subcategory }, ...rest]
    : rest.map((r) => ({ category: r.category, subcategory: r.subcategory }));
}

/** 番組の言語として選べるもの（ISO 639-1）。取り込んだ値がこれ以外でも、そのまま持つ。 */
export const SHOW_LANGUAGES = ['ja', 'en', 'zh', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'ru'] as const;
