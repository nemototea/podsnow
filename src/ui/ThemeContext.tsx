import { createContext, useContext, type ReactNode } from 'react';

import { colors, type Colors } from './tokens';

// テーマはダーク 1 つ（Issue #235、REQUIREMENTS.md FR-SET-1）。OS がライトでも同じ色を使う。
// 番組ごとの色（DESIGN_SYSTEM.md §2.6）はここではなく、番組を表示する画面が持つ。
const Ctx = createContext<Colors>(colors.dark);

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={colors.dark}>{children}</Ctx.Provider>;
}

export function useAppTheme() {
  return useContext(Ctx);
}
