export function parseSeconds(text: string): number | null {
  const v = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type RangeInputError = 'invalid' | 'order' | 'beyond';

export function validateRange(
  start: number | null,
  end: number | null,
  totalSec: number,
): RangeInputError | null {
  if (start === null || end === null) return 'invalid';
  if (end <= start) return 'order';
  if (end > totalSec + 1e-9) return 'beyond';
  return null;
}
