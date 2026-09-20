import type { ja } from './ja';

/** 対応ロケール（Issue #80、FR-I18N-1）。 */
export type Locale = 'ja' | 'en';

export const LOCALES: readonly Locale[] = ['ja', 'en'];

/** 端末ロケールに従うか、明示的に固定するか（`AppSettings.language`）。 */
export type LanguagePreference = 'system' | Locale;

/**
 * 文言カタログの形。`ja.ts` が正で、`en.ts` はこの型に縛られる。
 * キーの追加・削除・関数シグネチャの変更は両方に反映しないとビルドが落ちる。
 */
export type Messages = typeof ja;

export function isLocale(v: string): v is Locale {
  return (LOCALES as readonly string[]).includes(v);
}
