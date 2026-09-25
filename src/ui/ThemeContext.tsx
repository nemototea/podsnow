import { createContext, useContext, type ReactNode } from 'react';

import { colors, type Colors } from './tokens';
import { useTheme } from './useTheme';

const Ctx = createContext<Colors & { isDark: boolean }>({ ...colors.dark, isDark: true });

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

/**
 * 表示窓の中だけ、テーマに関係なくダークの色で描く（PN-01、#115）。
 * 表示窓は黒いガラスなので、中に置く波形・文字・アイコンはダークの値でちょうど読める。
 */
export function DarkInside({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={{ ...colors.dark, isDark: true }}>{children}</Ctx.Provider>;
}
