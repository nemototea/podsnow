import {
  initialNumbering,
  latestPublishedFull,
  parseNumberingInput,
  type PublishedNumbering,
} from '../numbering';

const DAY = 86_400_000;

function ep(
  day: number | null,
  episodeNumber: number | null,
  season: number | null = null,
  episodeType: PublishedNumbering['episodeType'] = 'full',
): PublishedNumbering {
  return { publishedAt: day === null ? null : day * DAY, episodeType, episodeNumber, season };
}

// ケースの ID は Issue #211 の「想定するケース」
describe('initialNumbering', () => {
  it('N-3: 配信済みの回が無ければ話数もシーズンも空', () => {
    expect(initialNumbering([])).toEqual({ episodeNumber: null, season: null });
  });

  it('N-1: 配信日が最新の本編の話数 + 1、シーズンは同じ値', () => {
    expect(initialNumbering([ep(1, 119, 2), ep(3, 121, 2), ep(2, 120, 2)])).toEqual({
      episodeNumber: 122,
      season: 2,
    });
  });

  it('N-2: 話数の無い RSS（開発者の番組）は空', () => {
    expect(initialNumbering([ep(1, null), ep(2, null), ep(3, null)])).toEqual({
      episodeNumber: null,
      season: null,
    });
  });

  it('S-1: 予告編・おまけは基準にしない', () => {
    expect(
      initialNumbering([ep(1, 12, 1), ep(2, null, null, 'bonus'), ep(3, 99, 9, 'trailer')]),
    ).toEqual({ episodeNumber: 13, season: 1 });
  });

  it('S-2: 古い回にだけ番号があり、最新の本編に無ければ空', () => {
    expect(initialNumbering([ep(1, 10, 1), ep(2, 11, 1), ep(3, null)])).toEqual({
      episodeNumber: null,
      season: null,
    });
  });

  it('S-3: 最新の本編の話数・シーズンが 0 なら空（+1 しない）', () => {
    expect(initialNumbering([ep(1, 5, 1), ep(2, 0, 0)])).toEqual({
      episodeNumber: null,
      season: null,
    });
  });

  it('話数とシーズンは別々に判定する（話数だけ・シーズンだけの番組）', () => {
    expect(initialNumbering([ep(1, 7, null)])).toEqual({ episodeNumber: 8, season: null });
    expect(initialNumbering([ep(1, null, 3)])).toEqual({ episodeNumber: null, season: 3 });
  });

  it('S-5: 話数が最大でなくても、最新の本編を基準にする（シーズンで振り直す番組）', () => {
    expect(initialNumbering([ep(1, 24, 2), ep(2, 1, 3)])).toEqual({ episodeNumber: 2, season: 3 });
  });

  it('E-1: 打ち間違いの話数でも最新ならその続き', () => {
    expect(initialNumbering([ep(1, 11), ep(2, 1200)])).toEqual({
      episodeNumber: 1201,
      season: null,
    });
  });

  it('E-2: 配信日の無い回は基準にしない。配信日のある本編が無ければ空', () => {
    expect(initialNumbering([ep(1, 3), ep(null, 50)])).toEqual({
      episodeNumber: 4,
      season: null,
    });
    expect(initialNumbering([ep(null, 50, 2)])).toEqual({ episodeNumber: null, season: null });
  });

  it('E-4: 同じ配信日の本編が 2 本あれば話数の大きい方', () => {
    expect(initialNumbering([ep(5, 8), ep(5, 9), ep(5, null)])).toEqual({
      episodeNumber: 10,
      season: null,
    });
    expect(initialNumbering([ep(5, 9), ep(5, 8)])).toEqual({ episodeNumber: 10, season: null });
  });

  it('小数・負の値は未設定として扱う', () => {
    expect(initialNumbering([ep(1, -3, -1)])).toEqual({ episodeNumber: null, season: null });
    expect(initialNumbering([ep(1, 2.5, 1.5)])).toEqual({ episodeNumber: null, season: null });
  });
});

describe('latestPublishedFull', () => {
  it('並び順に依らず同じ回を選ぶ', () => {
    const a = ep(3, 30);
    const list = [ep(1, 10), a, ep(2, 20), ep(4, null, null, 'bonus')];
    expect(latestPublishedFull(list)).toBe(a);
    expect(latestPublishedFull([...list].reverse())).toBe(a);
  });

  it('本編が無ければ null', () => {
    expect(latestPublishedFull([ep(1, 1, 1, 'trailer')])).toBeNull();
  });
});

describe('parseNumberingInput', () => {
  it.each([
    ['', null],
    ['  ', null],
    ['0', null],
    ['000', null],
    ['1', 1],
    [' 12 ', 12],
    ['007', 7],
  ])('%j → %j', (input, expected) => {
    expect(parseNumberingInput(input)).toBe(expected);
  });

  it.each(['-1', '1.5', 'abc', '１２', '1e3'])('%j は読めない（保存しない）', (input) => {
    expect(parseNumberingInput(input)).toBeUndefined();
  });
});
