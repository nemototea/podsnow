import { createContext, forwardRef, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
} from 'react-native';

import { useLocale } from '@/i18n';

import { loadedFonts, resolveFamily, type LoadedFonts } from './fonts';
import { family, type FamilyRole } from './tokens';

const FontsCtx = createContext<LoadedFonts>([]);

export function FontProvider({ children }: { children: ReactNode }) {
  const [loaded] = useState(loadedFonts);
  return <FontsCtx.Provider value={loaded}>{children}</FontsCtx.Provider>;
}

function useFamilyStyle(style: TextProps['style']) {
  const locale = useLocale();
  const loaded = useContext(FontsCtx);
  const requested = StyleSheet.flatten(style)?.fontFamily;
  return useMemo(() => {
    if (requested && requested !== family.numeric) return null;
    const resolved = resolveFamily(requested === family.numeric ? 'numeric' : 'ui', locale, loaded);
    return { fontFamily: resolved };
  }, [loaded, locale, requested]);
}

/**
 * ネイティブ部品（ナビゲーションバー、セグメント、日付ピッカー）に渡す書体名。
 * 読み込めていなければ undefined（OS の書体）を返す。
 */
export function useFontFamily(role: FamilyRole = 'ui'): string | undefined {
  const locale = useLocale();
  const loaded = useContext(FontsCtx);
  return useMemo(() => resolveFamily(role, locale, loaded), [loaded, locale, role]);
}

export function Text({ style, lineBreakStrategyIOS = 'standard', ...rest }: TextProps) {
  const fam = useFamilyStyle(style);
  // iOS の既定（'none'）は最終行に 1 語だけ残す折り返しをする。'standard' は UILabel と同じく
  // 最終行が短くなりすぎないよう押し出す（Web の text-wrap: pretty に相当）。
  return (
    <RNText
      {...rest}
      lineBreakStrategyIOS={lineBreakStrategyIOS}
      style={fam ? [style, fam] : style}
    />
  );
}

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput(
  { style, ...rest },
  ref,
) {
  const fam = useFamilyStyle(style);
  return <RNTextInput ref={ref} {...rest} style={fam ? [style, fam] : style} />;
});
