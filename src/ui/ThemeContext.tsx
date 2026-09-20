import { createContext, useContext, type ReactNode } from 'react';

import { palette, type Theme } from './theme';
import { useTheme } from './useTheme';

const Ctx = createContext<Theme & { isDark: boolean }>({ ...palette.dark, isDark: true });

export function ThemeProvider({
  pref,
  children,
}: {
  pref: 'dark' | 'light' | 'system';
  children: ReactNode;
}) {
  const t = useTheme(pref);
  return <Ctx.Provider value={t}>{children}</Ctx.Provider>;
}

export function useAppTheme() {
  return useContext(Ctx);
}
