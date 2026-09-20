import { en } from './en';
import { ja } from './ja';
import { isLocale, type LanguagePreference, type Locale, type Messages } from './types';

/** フォールバック先。端末が未対応の言語でも必ず表示できる言語を 1 つ決めておく。 */
export const FALLBACK_LOCALE: Locale = 'en';

export const CATALOGS: Readonly<Record<Locale, Messages>> = { ja, en };

export function messagesFor(locale: Locale): Messages {
  // DB に壊れた値が入っていても落とさない（loadSettings は値を検証しない）。
  return CATALOGS[locale] ?? CATALOGS[FALLBACK_LOCALE];
}

/**
 * 設定と端末ロケールから実際に使うロケールを決める（FR-I18N-2）。
 *
 * `preference` が `'system'` のときは端末の優先順で最初に対応しているものを採り、
 * どれも対応外なら `FALLBACK_LOCALE`。副作用なしの純関数なのでテストしやすい。
 *
 * @param deviceLanguageCodes 端末の言語コード（優先順）。`'ja'` / `'ja-JP'` どちらでもよい。
 */
export function resolveLocale(
  preference: LanguagePreference,
  deviceLanguageCodes: readonly (string | null | undefined)[],
): Locale {
  // 型は Locale を約束するが、値は DB 由来なので実行時にも確かめる。
  if (preference !== 'system') return isLocale(preference) ? preference : FALLBACK_LOCALE;
  for (const raw of deviceLanguageCodes) {
    if (!raw) continue;
    // 'ja-JP' / 'ja_JP' / 'JA' → 'ja'
    const code = raw.split(/[-_]/)[0]!.toLowerCase();
    if (isLocale(code)) return code;
  }
  return FALLBACK_LOCALE;
}
