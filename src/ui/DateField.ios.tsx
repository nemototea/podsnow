import DateTimePicker from '@react-native-community/datetimepicker';
import { StyleSheet, View } from 'react-native';

import { useLocale } from '@/i18n';

import type { DateFieldProps } from './DateField';
import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { hit, space, typography } from './tokens';

export type { DateFieldProps };

const pad = (n: number) => String(n).padStart(2, '0');

function parse(v: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
}

function format(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * iOS はコンパクトな日付ピッカー（DESIGN_SYSTEM.md §6.2）。押すとカレンダーが浮かぶ。
 * 値の形式は文字入力と同じ `YYYY-MM-DD` に揃え、呼び出し側を変えない。
 */
export function DateField({ label, value, onChange }: DateFieldProps) {
  const c = useAppTheme();
  const locale = useLocale();
  return (
    <View style={st.row}>
      <Text style={[typography.label, st.flex, { color: c.textSecondary }]}>{label}</Text>
      <DateTimePicker
        value={parse(value)}
        mode="date"
        display="compact"
        locale={locale === 'ja' ? 'ja-JP' : 'en-US'}
        accentColor={c.accentText}
        themeVariant={c.isDark ? 'dark' : 'light'}
        accessibilityLabel={label}
        onChange={(_e, d) => {
          if (d) onChange(format(d));
        }}
      />
    </View>
  );
}

const st = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: hit.min,
    gap: space.md,
    marginBottom: space.lg,
  },
});
