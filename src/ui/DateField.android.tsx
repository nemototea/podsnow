import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatDate, useLocale, useT } from '@/i18n';

import { CalendarSheet } from './CalendarSheet';
import type { DateFieldProps } from './DateField';
import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { field, hit, space, typography } from './tokens';

export type { DateFieldProps };

const pad = (n: number) => String(n).padStart(2, '0');

function parse(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function format(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Android は押すとアプリのカレンダー（`CalendarSheet`）が下から開く（Issue #167）。
 * OS の日付ダイアログ（`DateTimePickerAndroid`）は古めかしく、アプリの見た目と合わないので使わない。
 * 値の形式は文字入力・iOS と同じ `YYYY-MM-DD` に揃え、呼び出し側を変えない。
 */
export function DateField({ label, value, onChange }: DateFieldProps) {
  const c = useAppTheme();
  const t = useT();
  const locale = useLocale();
  const date = parse(value);
  const shown = date ? formatDate(date, locale) : t.common.notSet;
  const [open, setOpen] = useState(false);
  return (
    <View style={st.row}>
      <Text style={[typography.label, st.flex, { color: c.textSecondary }]}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${shown}`}
        style={({ pressed }) => [
          st.value,
          {
            backgroundColor: pressed ? c.surfaceHover : c.bg,
            borderColor: c.borderStrong,
            borderWidth: field.border,
          },
        ]}
      >
        <Text style={[typography.body, { color: date ? c.textPrimary : c.textTertiary }]}>
          {shown}
        </Text>
      </Pressable>
      {open ? (
        <CalendarSheet
          visible
          title={label}
          value={date}
          onSelect={(d) => onChange(format(d))}
          onClose={() => setOpen(false)}
        />
      ) : null}
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
  value: {
    minHeight: field.minHeight,
    justifyContent: 'center',
    paddingHorizontal: field.paddingX,
    borderRadius: field.radius,
  },
});
