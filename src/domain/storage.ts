export interface RecordableEstimate {
  seconds: number;
  unit: 'hours' | 'minutes';
  value: number;
}

export function estimateRecordable(
  availableBytes: number,
  opts: { sampleRate: number; channels: number; reserveBytes: number },
): RecordableEstimate | null {
  if (!Number.isFinite(availableBytes) || availableBytes <= 0) return null;
  const bytesPerSecond = opts.sampleRate * opts.channels * 2;
  if (bytesPerSecond <= 0) return null;
  const seconds = Math.max(0, (availableBytes - opts.reserveBytes) / bytesPerSecond);
  if (seconds >= 2 * 3600) {
    return { seconds, unit: 'hours', value: Math.floor(seconds / 3600) };
  }
  return { seconds, unit: 'minutes', value: Math.floor(seconds / 60) };
}

/**
 * 録り始めてよい最小の録れる時間（秒）。これ未満なら開始しない（FR-SAFE-5、Issue #165）。
 * 収録タブの「残り約 ◯ 分」は分の切り捨てなので、「残り約 0 分」のときだけ始められない。
 */
export const MIN_START_SECONDS = 60;

/** 録音を始めてよいか。残り時間の表示と同じ `estimateRecordable` の結果で判定する。 */
export function canStartRecording(estimate: RecordableEstimate | null): boolean {
  return estimate !== null && estimate.seconds >= MIN_START_SECONDS;
}
