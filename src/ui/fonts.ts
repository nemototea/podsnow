import { getLoadedFonts } from 'expo-font';

import type { Locale } from '@/i18n';

import { family, type FamilyRole } from './tokens';

export type LoadedFonts = readonly string[];

function squash(name: string): string {
  return name.replace(/[\s_-]/g, '').toLowerCase();
}

export function hasFamily(loaded: LoadedFonts, name: string): boolean {
  const key = squash(name);
  return loaded.some((n) => {
    const k = squash(n);
    return k === key || k.startsWith(key);
  });
}

export function resolveFamily(
  role: FamilyRole,
  locale: Locale,
  loaded: LoadedFonts,
): string | undefined {
  if (role === 'numeric' && hasFamily(loaded, family.numeric)) return family.numeric;
  // 数字の書体が無ければ、その言語の通常書体へ退避。コード用等幅には戻さない。
  const name = locale === 'ja' ? family.ja : family.latin;
  return hasFamily(loaded, name) ? name : undefined;
}

export function loadedFonts(): LoadedFonts {
  try {
    return getLoadedFonts() ?? [];
  } catch {
    return [];
  }
}
