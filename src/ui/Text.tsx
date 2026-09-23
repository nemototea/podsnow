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
import { family } from './tokens';

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
    if (requested && requested !== family.mono) return null;
    const resolved = resolveFamily(requested === family.mono ? 'mono' : 'ui', locale, loaded);
    return { fontFamily: resolved };
  }, [loaded, locale, requested]);
}

export function Text({ style, ...rest }: TextProps) {
  const fam = useFamilyStyle(style);
  return <RNText {...rest} style={fam ? [style, fam] : style} />;
}

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput(
  { style, ...rest },
  ref,
) {
  const fam = useFamilyStyle(style);
  return <RNTextInput ref={ref} {...rest} style={fam ? [style, fam] : style} />;
});
