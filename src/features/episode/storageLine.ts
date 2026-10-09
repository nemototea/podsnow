import type { Messages } from '@/i18n';

import type { RecordingContext } from './useRecordingContext';

/** これ以上録れるなら空き容量の行を出さない（DESIGN_SYSTEM.md §2.3「既定値のままなら出さない」、Issue #179）。 */
export const STORAGE_LINE_BELOW_SEC = 3600;

/**
 * 空き容量の行（DESIGN_SYSTEM.md §8）。録音中は「保存中 · 残り約」、止まったら置き換える。
 * 残りが 1 時間以上なら null（出さない）。保存が止まったとき・容量を確認できないときは、
 * 録音データの安全に関わるので常に出す（§2.3 の例外）。
 */
export function storageLine(
  t: Messages,
  ctx: Pick<RecordingContext, 'estimate' | 'writerOk'>,
  active: boolean,
): string | null {
  if (active && !ctx.writerOk) return t.record.savingStopped;
  const e = ctx.estimate;
  if (!e) return active ? t.record.savingOnDeviceUnknown : t.record.freeSpaceUnknown;
  if (e.seconds >= STORAGE_LINE_BELOW_SEC) return null;
  const left = e.unit === 'hours' ? t.record.hours(e.value) : t.record.minutes(e.value);
  return active ? t.record.savingOnDevice(left) : t.record.recordableFor(left);
}
