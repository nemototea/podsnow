import { useLocales } from 'expo-localization';
import { useMemo } from 'react';

/**
 * 端末の言語コード（OS の優先順）。
 *
 * `useLocales()` は OS の言語設定が変わると再レンダリングを起こす。
 * Android 13+ の「アプリごとの言語」もここに反映される（`locales_config.xml` が必要。
 * app.json の expo-localization プラグインで生成している）。
 *
 * `languageCode` が無い端末では `languageTag`（`'ja-JP'`）から拾う。
 * 正規化は `resolveLocale()` 側で行う。
 *
 * `useLocales()` が返す配列は OS 設定が変わるまで同じ参照なので、`map` の結果も
 * `useMemo` で固定する（毎レンダリングで新しい配列を返すと `LocaleProvider` の
 * メモ化が効かず、全画面が再レンダリングされる）。
 */
export function useDeviceLanguageCodes(): readonly string[] {
  const locales = useLocales();
  return useMemo(() => locales.map((l) => l.languageCode ?? l.languageTag), [locales]);
}

/**
 * 端末の地域（ISO 3166-1 alpha-2。例 `JP`）。番組検索の `country` に使う（Issue #101）。
 * 地域が取れない端末では null。
 */
export function useDeviceRegion(): string | null {
  const locales = useLocales();
  return useMemo(() => locales.find((l) => l.regionCode)?.regionCode ?? null, [locales]);
}
