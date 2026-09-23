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
