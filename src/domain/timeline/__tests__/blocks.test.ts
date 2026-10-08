import { smp } from '../../time';
import { blockAt, detectBlocks, snapToBoundary } from '../blocks';

const OPTS = { thresholdDb: -40, minSilenceSmp: smp(200) };
// -40 dBFS = 0.01。100 step あたり 100 smp とする。
const STEP = 100;

describe('detectBlocks', () => {
  it('無音で区切られた塊を返す', () => {
    // 声3 無音3 声2
    const levels = [0.5, 0.5, 0.5, 0, 0, 0, 0.4, 0.4];
    expect(detectBlocks(levels, STEP, smp(800), OPTS)).toEqual([
      { start: 0, end: 300 },
      { start: 600, end: 800 },
    ]);
  });

  it('短い息継ぎでは切らない', () => {
    // 無音が 1 step（100 smp）しか続かないので、しきい値 200 smp に届かない
    const levels = [0.5, 0, 0.5, 0.5];
    expect(detectBlocks(levels, STEP, smp(400), OPTS)).toEqual([{ start: 0, end: 400 }]);
  });

  it('しきい値より静かな音は声とみなさない', () => {
    const levels = [0.005, 0.004, 0.003, 0.002];
    expect(detectBlocks(levels, STEP, smp(400), OPTS)).toEqual([]);
  });

  it('末尾が声のまま終わっても閉じる', () => {
    const levels = [0, 0, 0.5, 0.5];
    expect(detectBlocks(levels, STEP, smp(400), OPTS)).toEqual([{ start: 200, end: 400 }]);
  });

  it('総尺を超えない', () => {
    const levels = [0.5, 0.5];
    expect(detectBlocks(levels, STEP, smp(150), OPTS)).toEqual([{ start: 0, end: 150 }]);
  });

  it('空の入力では何も返さない', () => {
    expect(detectBlocks([], STEP, smp(1000), OPTS)).toEqual([]);
    expect(detectBlocks([0.5], 0, smp(1000), OPTS)).toEqual([]);
    expect(detectBlocks([0.5], STEP, smp(0), OPTS)).toEqual([]);
  });
});

describe('blockAt', () => {
  const blocks = [
    { start: smp(0), end: smp(300) },
    { start: smp(600), end: smp(800) },
  ];
  it('含む塊を返す', () => expect(blockAt(blocks, smp(100))?.end).toBe(300));
  it('境界は次の塊に属さない', () => expect(blockAt(blocks, smp(300))).toBeNull());
  it('無音の位置では null', () => expect(blockAt(blocks, smp(450))).toBeNull());
});

describe('snapToBoundary', () => {
  const blocks = [
    { start: smp(0), end: smp(300) },
    { start: smp(600), end: smp(800) },
  ];
  it('近い境界に吸い付く', () => expect(snapToBoundary(blocks, smp(290), 50)).toBe(300));
  it('遠ければそのまま', () => expect(snapToBoundary(blocks, smp(450), 50)).toBe(450));
  it('塊の頭にも吸い付く', () => expect(snapToBoundary(blocks, smp(620), 50)).toBe(600));
});
