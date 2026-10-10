import type { PodcastFeedItem } from './feed';
import { htmlToPlainText } from './parseFeed';

/**
 * 取り込んだ回の概要から、概要欄テンプレートの候補を作る（Issue #260）。
 *
 * 毎回の概要に共通するのは、たいてい末尾の定型（お便りフォーム、SNS、ハッシュタグ、BGM の
 * クレジット）。直近の回の概要から**共通する行**を取り出し、いちばん新しい回の並びのまま返す。
 * 番組の概要（channel の `description`）は番組の紹介なので使わない。
 */

/** 見る回の数【仮説】。古い回は定型が今と違うことが多いので、直近だけを見る */
export const TEMPLATE_SAMPLE_SIZE = 5;
/** 候補を作るのに要る回の数【仮説】。1 回だけでは何が定型か分からない */
export const TEMPLATE_MIN_SAMPLES = 2;
/** 共通とみなす割合【仮説】。特別回で定型を省いた回が 1 本混ざっても拾えるように、全回一致にはしない */
export const TEMPLATE_COMMON_RATIO = 0.8;

/** 行の比べ方。全角・半角の揺れと、空白の数の違いは同じ行とみなす。 */
export function normalizeLine(line: string): string {
  return line.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** 概要を行に分ける。HTML は文字にしてから（docs/podcast-import-cases.md E-9）。 */
export function descriptionLines(description: string): string[] {
  return htmlToPlainText(description)
    .split('\n')
    .map((l) => l.trim());
}

/** 直近の回（配信日の新しい順。配信日の無い回は後ろ）のうち、概要のあるものを `size` 本。 */
export function recentDescriptions(
  items: readonly Pick<PodcastFeedItem, 'description' | 'publishedAt'>[],
  size: number = TEMPLATE_SAMPLE_SIZE,
): string[] {
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => htmlToPlainText(item.description) !== '')
    .sort(
      (a, b) =>
        (b.item.publishedAt ?? -Infinity) - (a.item.publishedAt ?? -Infinity) || a.index - b.index,
    )
    .slice(0, size)
    .map(({ item }) => item.description);
}

/**
 * 概要の並び（新しい順）から、共通する行を取り出す。共通する行が無ければ null。
 *
 * - 行は `normalizeLine` で比べる。1 本の中で同じ行が何度出ても 1 回と数える。
 * - `TEMPLATE_COMMON_RATIO` 以上の回に出る行を共通とする。
 * - 並びと文字は、共通する行をいちばん多く含む回（同数なら新しい回）のものを使う。
 *   その回で空行を挟んでいた行どうしの間にだけ、空行を 1 つ入れる。
 */
export function commonDescriptionLines(descriptions: readonly string[]): string | null {
  if (descriptions.length < TEMPLATE_MIN_SAMPLES) return null;
  const samples = descriptions.map(descriptionLines);
  const counts = new Map<string, number>();
  for (const lines of samples) {
    for (const key of new Set(lines.map(normalizeLine))) {
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const need = Math.max(TEMPLATE_MIN_SAMPLES, Math.ceil(samples.length * TEMPLATE_COMMON_RATIO));
  const common = new Set([...counts].filter(([, n]) => n >= need).map(([k]) => k));
  if (!common.size) return null;

  const score = (lines: string[]) =>
    new Set(lines.map(normalizeLine).filter((k) => common.has(k))).size;
  let base = samples[0]!;
  for (const lines of samples) if (score(lines) > score(base)) base = lines;

  const out: string[] = [];
  let gap = false;
  for (const line of base) {
    if (line === '') {
      gap = true;
      continue;
    }
    if (!common.has(normalizeLine(line))) continue;
    if (gap && out.length) out.push('');
    out.push(line);
    gap = false;
  }
  return out.join('\n');
}

/** 取り込む回から、概要欄テンプレートの候補を作る。作れなければ null。 */
export function suggestDescriptionTemplate(
  items: readonly Pick<PodcastFeedItem, 'description' | 'publishedAt'>[],
): string | null {
  return commonDescriptionLines(recentDescriptions(items));
}

/**
 * 今のテンプレートが「手で書いていない」状態か（空、または初期値のまま）。
 * このときだけ、候補を既定で選んでおく。`seeds` は各言語の初期値（どの言語で作られたか分からないため）。
 */
export function isUntouchedTemplate(body: string | null, seeds: readonly string[]): boolean {
  const b = (body ?? '').trim();
  return b === '' || seeds.some((s) => s.trim() === b);
}
