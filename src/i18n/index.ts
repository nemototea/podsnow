export {
  FALLBACK_LOCALE,
  isLocale,
  LOCALES,
  resolveLocale,
  type LanguagePreference,
  type Locale,
} from '@/domain/locale';

export { errorCodeText, errorText, storedErrorText } from './errorText';
export { formatDate, formatDateTime, INTL_TAG } from './format';
export { LocaleProvider, useLocale, useT } from './LocaleContext';
export { CATALOGS, messagesFor } from './resolve';
export type { Messages } from './types';
