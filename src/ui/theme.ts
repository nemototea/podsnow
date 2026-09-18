// テーマトークン。pre-dev-sample のダーク配色を出発点にする（ARCHITECTURE.md §7.6）。
export const palette = {
  dark: {
    bg: '#0B0C0F',
    panel: '#15171C',
    panel2: '#1C1F26',
    line: '#25282F',
    ink: '#F4F2EE',
    ink2: '#8E949D',
    ink3: '#5C616A',
    accent: '#E2B979',
    voice: '#8FD4C1',
    music: '#B7A3E6',
    insert: '#E9A6A6',
    rec: '#E5484D',
    mistake: '#F2A65A',
  },
  light: {
    bg: '#FAF8F4',
    panel: '#FFFFFF',
    panel2: '#F1EEE8',
    line: '#E3DFD7',
    ink: '#16181D',
    ink2: '#5C616A',
    ink3: '#9AA0A8',
    accent: '#B8862F',
    voice: '#2E8F75',
    music: '#6F55B3',
    insert: '#B84A4A',
    rec: '#D93036',
    mistake: '#C97A2A',
  },
} as const;

export type ThemeName = keyof typeof palette;
export type Theme = (typeof palette)[ThemeName];
