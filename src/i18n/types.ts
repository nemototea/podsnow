import type { ja } from './ja';

export type { LanguagePreference, Locale } from '@/domain/locale';
export { FALLBACK_LOCALE, isLocale, LOCALES, resolveLocale } from '@/domain/locale';

/**
 * 文言カタログの形。`ja.ts` が正で、`en.ts` はこの型に縛られる。
 * キーの追加・削除・関数シグネチャの変更は両方に反映しないとビルドが落ちる。
 */
export type Messages = typeof ja;
