/**
 * 編集の波形の横スクロールの位置（Issue #176）。画面に依存しない計算だけを置き、Jest で試す。
 * 位置はすべて ScrollView の中身の座標（px）。
 */

/** 追うときに再生位置を置く場所（見本 `.playhead` の left 46%）。 */
export const PLAYHEAD_AT = 0.46;

export interface Viewport {
  /** 今のスクロール位置。 */
  scrollX: number;
  /** 見えている幅。 */
  viewW: number;
  /** 中身の幅（左右の余白を含む）。 */
  contentW: number;
}

/** スクロールできる範囲に収める。 */
export function clampScroll(x: number, v: Pick<Viewport, 'viewW' | 'contentW'>): number {
  return Math.max(0, Math.min(Math.max(0, v.contentW - v.viewW), x));
}

/** 再生位置の線が見えているか。 */
export function isVisible(headX: number, v: Pick<Viewport, 'scrollX' | 'viewW'>): boolean {
  return headX >= v.scrollX && headX <= v.scrollX + v.viewW;
}

/** 再生位置を見本の位置（`PLAYHEAD_AT`）に置くスクロール位置。 */
export function centerOn(headX: number, v: Pick<Viewport, 'viewW' | 'contentW'>): number {
  return clampScroll(headX - v.viewW * PLAYHEAD_AT, v);
}

export interface FollowState {
  /** 指でスクロールしている間。 */
  dragging: boolean;
  /**
   * 追ってよいか。指を離したときに再生位置が画面の外なら false にし、
   * 一度画面に入ってからまた外へ出るまでは追わない。
   */
  armed: boolean;
}

/**
 * 再生中、再生位置が動いたときに呼ぶ。動かすならスクロール位置、動かさないなら null と、次の状態を返す。
 * - 指でスクロールしている間は追わない
 * - 画面内にあれば何もしない（見えたので、次に外へ出たら追う）
 * - 画面の外へ出たら、見本の位置へ移す
 */
export function follow(
  headX: number,
  v: Viewport,
  s: FollowState,
): { scrollTo: number | null; state: FollowState } {
  if (s.dragging) return { scrollTo: null, state: s };
  if (isVisible(headX, v)) return { scrollTo: null, state: s.armed ? s : { ...s, armed: true } };
  if (!s.armed) return { scrollTo: null, state: s };
  const to = centerOn(headX, v);
  return { scrollTo: Math.abs(to - v.scrollX) < 1 ? null : to, state: s };
}

/** 指を離したときの状態。そのとき再生位置が見えていれば、次に外へ出たら追う。 */
export function release(headX: number, v: Pick<Viewport, 'scrollX' | 'viewW'>): FollowState {
  return { dragging: false, armed: isVisible(headX, v) };
}

/**
 * シーク・カット・取り消し / やり直しの後。再生位置が画面外なら見える位置へ移す（指の操作中は除く）。
 * 移した後は追ってよい状態にする。
 */
export function reveal(headX: number, v: Viewport, s: FollowState): number | null {
  if (s.dragging || isVisible(headX, v)) return null;
  return centerOn(headX, v);
}

/**
 * 拡大率を変えたときのスクロール位置。再生位置が見えていれば画面上の同じ位置に保ち、
 * 見えていなければ画面の中央の時刻を保つ。
 *
 * @param pad 中身の左の余白（時刻 0 の位置）
 * @param headSec 再生位置（秒）
 */
export function zoomScroll(args: {
  pad: number;
  headSec: number;
  oldPps: number;
  newPps: number;
  scrollX: number;
  viewW: number;
  /** 拡大率を変えた後の中身の幅。 */
  newContentW: number;
}): number {
  const { pad, headSec, oldPps, newPps, scrollX, viewW, newContentW } = args;
  const oldHead = pad + headSec * oldPps;
  const v = { viewW, contentW: newContentW };
  if (isVisible(oldHead, { scrollX, viewW })) {
    const onScreen = oldHead - scrollX;
    return clampScroll(pad + headSec * newPps - onScreen, v);
  }
  const midSec = (scrollX + viewW / 2 - pad) / oldPps;
  return clampScroll(pad + midSec * newPps - viewW / 2, v);
}
