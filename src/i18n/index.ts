export {
  FALLBACK_LOCALE,
  isLocale,
  LOCALES,
  resolveLocale,
  type LanguagePreference,
  type Locale,
} from '@/domain/locale';

export { episodeName, episodeRef } from './episodeText';
export { errorCodeText, errorText, storedErrorText } from './errorText';
export {
  formatDate,
  formatDateTime,
  formatMonth,
  formatShortDate,
  INTL_TAG,
  weekdayNames,
} from './format';
export { LocaleProvider, useLocale, useT } from './LocaleContext';
export { CATALOGS, messagesFor } from './resolve';
export type { Messages } from './types';
