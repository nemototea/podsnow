import { createContext, useContext, useMemo, type ReactNode } from 'react';

import {
  FALLBACK_LOCALE,
  resolveLocale,
  type LanguagePreference,
  type Locale,
} from '@/domain/locale';

import { useDeviceLanguageCodes } from './deviceLocale';
import { messagesFor } from './resolve';
import type { Messages } from './types';

interface LocaleValue {
  /** 実際に表示に使っているロケール。 */
  locale: Locale;
  /** 文言カタログ。 */
  t: Messages;
}

const Ctx = createContext<LocaleValue>({
  locale: FALLBACK_LOCALE,
  t: messagesFor(FALLBACK_LOCALE),
});

/**
 * 文言を供給する（FR-I18N-2, FR-I18N-3）。
 *
 * `pref` は `AppSettings.language`。`'system'` のときだけ端末ロケールを見る。
 * ThemeProvider と同じで、設定変更は再起動なしで反映される。
 */
export function LocaleProvider({
  pref = 'system',
  children,
}: {
  pref?: LanguagePreference;
  children: ReactNode;
}) {
  const deviceCodes = useDeviceLanguageCodes();
  const value = useMemo<LocaleValue>(() => {
    const locale = resolveLocale(pref, deviceCodes);
    return { locale, t: messagesFor(locale) };
  }, [pref, deviceCodes]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 文言カタログ。`const t = useT(); t.home.restore` のように使う。 */
export function useT(): Messages {
  return useContext(Ctx).t;
}

/** 実際に使われているロケール（日付整形などで必要なとき）。 */
export function useLocale(): Locale {
  return useContext(Ctx).locale;
}
