/**
 * ドラッグによる並べ替えの位置計算（`ReorderList`）。px を扱うので `domain/` ではなく UI に置く。
 * ジェスチャーの UI スレッドから呼ぶため worklet にしてある。Jest からはただの関数として呼べる。
 */

/**
 * 掴んだ行を縦に `dy` 動かして離したとき、何番目に入るか。
 * 隣の行の高さの半分を越えたら入れ替わる。行の高さは揃っていなくてよい。
 * `from` が範囲外なら動かさない。
 */
export function dropIndex(heights: readonly number[], from: number, dy: number): number {
  'worklet';
  const n = heights.length;
  if (from < 0 || from >= n) return from;
  let to = from;
  let passed = 0;
  if (dy > 0) {
    for (let i = from + 1; i < n; i++) {
      const h = heights[i] ?? 0;
      if (dy <= passed + h / 2) break;
      to = i;
      passed += h;
    }
  } else if (dy < 0) {
    for (let i = from - 1; i >= 0; i--) {
      const h = heights[i] ?? 0;
      if (-dy <= passed + h / 2) break;
      to = i;
      passed += h;
    }
  }
  return to;
}

/**
 * 掴んだ行が `from` から `to` へ動く間、`index` の行がどれだけ避けるか。
 * 間にある行だけが、掴んだ行の高さぶん逆向きにずれる。
 */
export function shiftFor(index: number, from: number, to: number, fromHeight: number): number {
  'worklet';
  if (from < 0 || index === from) return 0;
  if (from < to && index > from && index <= to) return -fromHeight;
  if (to < from && index >= to && index < from) return fromHeight;
  return 0;
}

/**
 * 掴んだ行を `to` の位置へ収めるのに要る縦の移動量。離したあと、この量まで吸い付かせる。
 */
export function slotOffset(heights: readonly number[], from: number, to: number): number {
  'worklet';
  let sum = 0;
  if (to > from) for (let i = from + 1; i <= to; i++) sum += heights[i] ?? 0;
  else for (let i = to; i < from; i++) sum -= heights[i] ?? 0;
  return sum;
}
