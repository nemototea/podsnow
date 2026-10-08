/**
 * 時間の内部表現はサンプル数（48 kHz 基準）の整数。UI 表示時のみ ms に変換する。
 * ARCHITECTURE.md §7.2 / DATA_MODEL.md §1
 */
export const SAMPLE_RATE = 48000;

declare const smpBrand: unique symbol;
/** サンプル数（整数）。number と混同しないためのブランド型。 */
export type Smp = number & { readonly [smpBrand]: true };

export function smp(n: number): Smp {
  if (!Number.isFinite(n)) throw new RangeError(`smp: not finite: ${n}`);
  return Math.round(n) as Smp;
}

export const ZERO_SMP = 0 as Smp;

export function addSmp(a: Smp, b: Smp): Smp {
  return (a + b) as Smp;
}

export function subSmp(a: Smp, b: Smp): Smp {
  return (a - b) as Smp;
}

export function msToSmp(ms: number, sampleRate: number = SAMPLE_RATE): Smp {
  return smp((ms * sampleRate) / 1000);
}

export function smpToMs(s: Smp, sampleRate: number = SAMPLE_RATE): number {
  return (s * 1000) / sampleRate;
}

export function secToSmp(sec: number, sampleRate: number = SAMPLE_RATE): Smp {
  return smp(sec * sampleRate);
}

/** 表示用 mm:ss（ms=true なら mm:ss.d）。 */
export function formatSmp(s: Smp, opts: { tenths?: boolean; sampleRate?: number } = {}): string {
  const total = Math.max(0, smpToMs(s, opts.sampleRate) / 1000);
  const m = Math.floor(total / 60);
  const sec = total - m * 60;
  const mm = String(m).padStart(2, '0');
  if (opts.tenths) return `${mm}:${sec.toFixed(1).padStart(4, '0')}`;
  return `${mm}:${String(Math.floor(sec)).padStart(2, '0')}`;
}

export function formatClock(s: Smp, sampleRate: number = SAMPLE_RATE): string {
  const total = Math.max(0, Math.floor(smpToMs(s, sampleRate) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
