import { useLocales } from 'expo-localization';

/**
 * 端末の言語コード（OS の優先順）。
 *
 * `useLocales()` は OS の言語設定が変わると再レンダリングを起こす。
 * Android 13+ の「アプリごとの言語」もここに反映される（`locales_config.xml` が必要。
 * app.json の expo-localization プラグインで生成している）。
 *
 * `languageCode` が無い端末では `languageTag`（`'ja-JP'`）から拾う。
 * 正規化は `resolveLocale()` 側で行う。
 */
export function useDeviceLanguageCodes(): readonly string[] {
  const locales = useLocales();
  return locales.map((l) => l.languageCode ?? l.languageTag);
}
