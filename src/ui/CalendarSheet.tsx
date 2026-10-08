import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatDate, formatMonth, useLocale, useT, weekdayNames } from '@/i18n';

import { monthGrid, sameDay, shiftMonth, toCalendarDay, type CalendarDay } from './calendarGrid';
import { Button, IconButton } from './components';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { useAppTheme } from './ThemeContext';
import { hit, radius, space, tabularNums, typography } from './tokens';

export interface CalendarSheetProps {
  visible: boolean;
  title: string;
  /** 選ばれている日。未設定は null（今日の月を開く）。 */
  value: Date | null;
  onSelect: (d: Date) => void;
  onClose: () => void;
}

/**
 * 日付を選ぶシート（Issue #167）。Android の OS の日付ダイアログはアプリの見た目と合わないので、
 * トークンで組んだ月のカレンダーを下から出す。日を押したら選んで閉じる。
 */
export function CalendarSheet({ visible, title, value, onSelect, onClose }: CalendarSheetProps) {
  const t = useT();
  const locale = useLocale();
  const c = useAppTheme();
  const start = value ?? new Date();
  const [shown, setShown] = useState({ year: start.getFullYear(), month: start.getMonth() });
  const selected = value ? toCalendarDay(value) : null;
  const today = toCalendarDay(new Date());
  const pick = (d: CalendarDay) => {
    onSelect(new Date(d.year, d.month, d.day));
    onClose();
  };
  const move = (n: number) => setShown((m) => shiftMonth(m.year, m.month, n));

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={st.header}>
        <IconButton name="back" label={t.common.calendar.previousMonth} onPress={() => move(-1)} />
        <Text
          style={[typography.heading, st.month, { color: c.textPrimary }]}
          accessibilityRole="header"
        >
          {formatMonth(new Date(shown.year, shown.month, 1), locale)}
        </Text>
        <IconButton name="arrow" label={t.common.calendar.nextMonth} onPress={() => move(1)} />
      </View>
      <View style={st.week}>
        {weekdayNames(locale).map((w, i) => (
          <Text
            key={i}
            style={[typography.overline, st.weekday, { color: c.textTertiary }]}
            importantForAccessibility="no"
          >
            {w}
          </Text>
        ))}
      </View>
      {monthGrid(shown.year, shown.month).map((week, wi) => (
        <View key={wi} style={st.week}>
          {week.map((d, di) => {
            if (!d) return <View key={di} style={st.cell} />;
            const on = sameDay(d, selected);
            const isToday = sameDay(d, today);
            const label = formatDate(new Date(d.year, d.month, d.day), locale);
            return (
              <View key={di} style={st.cell}>
                <Pressable
                  onPress={() => pick(d)}
                  accessibilityRole="button"
                  accessibilityLabel={isToday ? `${label}, ${t.common.calendar.today}` : label}
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [
                    st.day,
                    {
                      backgroundColor: on
                        ? pressed
                          ? c.accentSolidPressed
                          : c.accentSolid
                        : pressed
                          ? c.surfaceHover
                          : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={[
                      on || isToday ? typography.bodyStrong : typography.body,
                      tabularNums,
                      { color: on ? c.accentOnSolid : isToday ? c.accentText : c.textPrimary },
                    ]}
                  >
                    {d.day}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
      <View style={st.footer}>
        <Button
          label={t.common.calendar.today}
          kind="secondary"
          compact
          onPress={() => {
            setShown({ year: today.year, month: today.month });
            pick(today);
          }}
        />
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: space.sm },
  month: { flex: 1, textAlign: 'center' },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', paddingVertical: space.xs },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: hit.min },
  day: {
    width: hit.min,
    height: hit.min,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: space.lg },
});
