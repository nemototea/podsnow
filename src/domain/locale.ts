/**
 * 対応ロケールの値型（Issue #80、FR-I18N-1）。
 *
 * 文言そのものは `src/i18n/` にあるが、「どの言語コードを扱うか」は
 * 設定として DB にも入る純粋なデータなので domain に置く。
 * これにより infra / services が UI 層（`src/i18n/`）を import せずに済む。
 */
export type Locale = 'ja' | 'en';

export const LOCALES: readonly Locale[] = ['ja', 'en'];

/** フォールバック先。端末が未対応の言語でも必ず表示できる言語。 */
export const FALLBACK_LOCALE: Locale = 'en';

/** 端末ロケールに従うか、明示的に固定するか（`AppSettings.language`）。 */
export type LanguagePreference = 'system' | Locale;

export function isLocale(v: string): v is Locale {
  return (LOCALES as readonly string[]).includes(v);
}

/**
 * 設定と端末ロケールから実際に使うロケールを決める（FR-I18N-2）。
 *
 * `preference` が `'system'` のときは端末の優先順で最初に対応しているものを採り、
 * どれも対応外なら `FALLBACK_LOCALE`。
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
