import { FALLBACK_LOCALE, type Locale } from '@/domain/locale';

import { en } from './en';
import { ja } from './ja';
import type { Messages } from './types';

export const CATALOGS: Readonly<Record<Locale, Messages>> = { ja, en };

export function messagesFor(locale: Locale): Messages {
  // DB に壊れた値が入っていても落とさない（loadSettings は値を検証しない）。
  return CATALOGS[locale] ?? CATALOGS[FALLBACK_LOCALE];
}
