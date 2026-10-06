import type { Messages } from '@/i18n';

import type { RecordingContext } from './useRecordingContext';

/** 空き容量の行（DESIGN_SYSTEM.md §8）。録音中は「保存中 · 残り約」、止まったら置き換える。 */
export function storageLine(t: Messages, ctx: RecordingContext, active: boolean): string {
  if (active && !ctx.writerOk) return t.record.savingStopped;
  const left = ctx.estimate
    ? ctx.estimate.unit === 'hours'
      ? t.record.hours(ctx.estimate.value)
      : t.record.minutes(ctx.estimate.value)
    : null;
  if (active) return left ? t.record.savingOnDevice(left) : t.record.savingOnDeviceUnknown;
  return left ? t.record.recordableFor(left) : t.record.freeSpaceUnknown;
}
