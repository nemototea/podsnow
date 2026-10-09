import {
  PLAYHEAD_AT,
  clampScroll,
  follow,
  release,
  reveal,
  zoomScroll,
  type FollowState,
} from '../waveScroll';

const v = { scrollX: 0, viewW: 400, contentW: 4000 };
const armed: FollowState = { dragging: false, armed: true };

describe('波形のスクロール位置（Issue #176）', () => {
  it('スクロールできる範囲に収める', () => {
    expect(clampScroll(-10, v)).toBe(0);
    expect(clampScroll(5000, v)).toBe(3600);
    expect(clampScroll(100, { viewW: 400, contentW: 300 })).toBe(0);
  });

  describe('再生中に追う', () => {
    it('画面内にあれば動かさない', () => {
      expect(follow(399, v, armed).scrollTo).toBeNull();
    });

    it('右の端を越えたら、見本の位置（46%）へ移す', () => {
      const r = follow(401, v, armed);
      expect(r.scrollTo).toBeCloseTo(401 - 400 * PLAYHEAD_AT);
    });

    it('指でスクロールしている間は追わない', () => {
      expect(follow(900, v, { dragging: true, armed: true }).scrollTo).toBeNull();
    });

    it('指を離したとき画面外なら、一度画面に入ってまた外へ出るまで追わない', () => {
      let s = release(900, v);
      expect(s).toEqual({ dragging: false, armed: false });
      // 画面外のまま進んでも追わない
      let r = follow(950, v, s);
      expect(r.scrollTo).toBeNull();
      s = r.state;
      // 画面に入った（手でスクロールした先へ再生位置が来た）
      r = follow(950, { ...v, scrollX: 800 }, s);
      expect(r.scrollTo).toBeNull();
      s = r.state;
      expect(s.armed).toBe(true);
      // また外へ出たら追う
      r = follow(1201, { ...v, scrollX: 800 }, s);
      expect(r.scrollTo).toBeCloseTo(1201 - 400 * PLAYHEAD_AT);
    });

    it('指を離したとき画面内なら、そのまま追う', () => {
      expect(release(100, v)).toEqual({ dragging: false, armed: true });
    });
  });

  describe('シーク・カット・取り消しの後に見せる', () => {
    it('画面外なら見える位置へ移す。追わない状態でも移す', () => {
      expect(reveal(2000, v, { dragging: false, armed: false })).toBeCloseTo(
        2000 - 400 * PLAYHEAD_AT,
      );
    });

    it('画面内なら動かさない', () => {
      expect(reveal(200, v, armed)).toBeNull();
    });

    it('先頭の近くなら 0 に収める', () => {
      expect(reveal(50, { ...v, scrollX: 1000 }, armed)).toBe(0);
    });

    it('指の操作中は動かさない', () => {
      expect(reveal(2000, v, { dragging: true, armed: true })).toBeNull();
    });
  });

  describe('拡大・縮小', () => {
    const base = { pad: 12, oldPps: 24, newPps: 38.4, viewW: 400, newContentW: 100000 };

    it('再生位置が見えていれば、画面上の同じ位置に保つ', () => {
      // 再生位置 20 秒 = 12 + 480 = 492。スクロール 300 なら画面上 192
      const to = zoomScroll({ ...base, headSec: 20, scrollX: 300 });
      expect(12 + 20 * 38.4 - to).toBeCloseTo(192);
    });

    it('再生位置が見えていなければ、画面の中央の時刻を保つ', () => {
      // 中央 = 2000 + 200 - 12 = 2188px → 91.1666 秒
      const to = zoomScroll({ ...base, headSec: 0, scrollX: 2000 });
      const midSec = (2000 + 200 - 12) / 24;
      expect(to + 200 - 12).toBeCloseTo(midSec * 38.4);
    });

    it('縮めて先頭より左になるときは 0 に収める', () => {
      expect(zoomScroll({ ...base, newPps: 4, headSec: 10, scrollX: 100 })).toBe(0);
    });
  });
});
