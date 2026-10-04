/**
 * ラウドネス測定のキャッシュ（AUDIO_DESIGN.md §8.4、DATA_MODEL.md §4.5 `episodes.loudness_cache`、Issue #158）。
 *
 * 試聴（書き出しタブ）と書き出しで同じゲインを使うため、ネイティブの `solveGain` の結果を回ごとに持つ。
 * キーは音の指紋（`renderFingerprint`）＋ チャンネル数 ＋ 測定手順の版。
 */
import type { LoudnessSettings } from './types';

/**
 * 測定手順の版。ネイティブの `LoudnessRenderer.ALGO_VERSION`（Kotlin / Swift）と同じ値にする。
 * `Loudness` の定数や手順を変えたら両方を上げ、保存した値を使わせない。
 */
export const LOUDNESS_ALGO = 1;

/** ゲインの範囲（ネイティブの `MIN_GAIN_DB` / `MAX_GAIN_DB`）。 */
export const MIN_GAIN_DB = -40;
export const MAX_GAIN_DB = 20;

export interface LoudnessCacheEntry {
  /** 声の並び・素材の配置・音の仕上げの指紋（`source_fingerprint` と同じ計算）。 */
  fingerprint: string;
  channels: 1 | 2;
  algo: number;
  /** 目標に合わせるゲイン（dB）。 */
  gainDb: number;
  /** 測ったときの目標（LUFS）。目標だけを変えたときの仮のゲインに使う。 */
  targetLufs: number;
  /** 調整前のミックスの統合ラウドネス（LUFS）。分からなければ null。 */
  inputLufs: number | null;
  measuredAt: number;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** DB の値（JSON。壊れていても落とさない）から使える行だけを取り出す。 */
export function parseLoudnessCache(json: string | null | undefined): LoudnessCacheEntry[] {
  let raw: unknown;
  try {
    raw = json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: LoudnessCacheEntry[] = [];
  for (const v of raw) {
    if (typeof v !== 'object' || v === null) continue;
    const o = v as Record<string, unknown>;
    if (typeof o.fingerprint !== 'string' || (o.channels !== 1 && o.channels !== 2)) continue;
    if (!isNum(o.algo) || !isNum(o.gainDb) || !isNum(o.targetLufs) || !isNum(o.measuredAt))
      continue;
    out.push({
      fingerprint: o.fingerprint,
      channels: o.channels,
      algo: o.algo,
      gainDb: o.gainDb,
      targetLufs: o.targetLufs,
      inputLufs: isNum(o.inputLufs) ? o.inputLufs : null,
      measuredAt: o.measuredAt,
    });
  }
  return out;
}

/** 今の音（指紋・チャンネル数）のゲイン。無ければ null（測り直しが要る）。 */
export function findCachedGain(
  entries: readonly LoudnessCacheEntry[],
  fingerprint: string,
  channels: 1 | 2,
): number | null {
  const hit = entries.find(
    (e) => e.fingerprint === fingerprint && e.channels === channels && e.algo === LOUDNESS_ALGO,
  );
  return hit ? hit.gainDb : null;
}

/**
 * 測り終わるまでの仮のゲイン（AUDIO_DESIGN.md §7.1「測定が終わるまでの音」）。
 * このチャンネル数の前回の値を、目標の差だけずらす。前回が無ければ null（調整なしで鳴らす）。
 */
export function interimGain(
  entries: readonly LoudnessCacheEntry[],
  channels: 1 | 2,
  loudness: LoudnessSettings,
): number | null {
  const prev = entries
    .filter((e) => e.channels === channels && e.algo === LOUDNESS_ALGO)
    .sort((a, b) => b.measuredAt - a.measuredAt)[0];
  if (!prev) return null;
  return shiftGain(prev.gainDb, prev.targetLufs, loudness.targetLufs);
}

/** 目標だけを変えたときのゲイン（リミッターが働かない回はこれで正確）。 */
export function shiftGain(gainDb: number, fromTarget: number, toTarget: number): number {
  return Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, gainDb + (toTarget - fromTarget)));
}

/** 測った結果を入れる。チャンネル数ごとに最新の 1 件だけ残す（最大 2 件）。 */
export function upsertLoudnessCache(
  entries: readonly LoudnessCacheEntry[],
  entry: LoudnessCacheEntry,
): LoudnessCacheEntry[] {
  return [...entries.filter((e) => e.channels !== entry.channels), entry].sort(
    (a, b) => a.channels - b.channels,
  );
}
