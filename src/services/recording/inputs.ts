import type { AudioInput } from '../../../modules/podsnow-recorder/src/PodsnowRecorder.types';

/**
 * 入力の一覧から、利用者が区別できない重複を除く（先勝ち）。
 *
 * Android は内蔵マイクを位置（下・背面など）ごとに別デバイスとして返し、名前はどれも端末名になる。
 * 種類と名前が同じものは画面上で見分けられないので 1 件にまとめる。どのマイクを使うかは録音ソースで
 * 端末が決める（AUDIO_DESIGN.md）。
 */
export function selectableInputs(inputs: readonly AudioInput[]): AudioInput[] {
  const seen = new Set<string>();
  const out: AudioInput[] = [];
  for (const input of inputs) {
    const key = `${input.type}\u0000${input.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(input);
  }
  return out;
}
