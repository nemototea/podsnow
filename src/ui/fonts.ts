import { getLoadedFonts } from 'expo-font';
import { Platform } from 'react-native';

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

const MONO_FALLBACK = Platform.select({ ios: 'Menlo', default: 'monospace' });

export function resolveFamily(
  role: FamilyRole,
  locale: Locale,
  loaded: LoadedFonts,
): string | undefined {
  if (role === 'mono') {
    return hasFamily(loaded, family.mono) ? family.mono : MONO_FALLBACK;
  }
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
