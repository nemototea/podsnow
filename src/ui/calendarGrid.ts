/**
 * 月のカレンダーの並び（Issue #167。Android の日付選び `CalendarSheet` が使う）。
 * 端末の現地時刻で数える。週は日曜はじまり（日本と米国の慣習。DESIGN_SYSTEM.md §6.2）。
 */

export interface CalendarDay {
  year: number;
  /** 0 はじまり（`Date#getMonth()` と同じ）。 */
  month: number;
  day: number;
}

/** その月の週の並び。月の外の枠は null。行の数は 4〜6。 */
export function monthGrid(year: number, month: number): (CalendarDay | null)[][] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (CalendarDay | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= days; day++) cells.push({ year, month, day });
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (CalendarDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** 月を n か月ずらす（年をまたぐ）。 */
export function shiftMonth(
  year: number,
  month: number,
  n: number,
): { year: number; month: number } {
  const d = new Date(year, month + n, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function sameDay(a: CalendarDay | null, b: CalendarDay | null): boolean {
  return !!a && !!b && a.year === b.year && a.month === b.month && a.day === b.day;
}

export function toCalendarDay(d: Date): CalendarDay {
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
}
