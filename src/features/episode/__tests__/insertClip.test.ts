import { smp } from '@/domain/time';

import { newInsertedClip } from '../insertClip';

const voice = [
  {
    id: 'v1',
    takeId: 'T1',
    srcStart: smp(1000),
    srcEnd: smp(49000),
    gainDb: 0,
    fadeIn: smp(0),
    fadeOut: smp(0),
  },
];
const jingle = { id: 'a1', kind: 'jingle' as const, default_gain_db: -3 };

describe('素材を入れるときの重ねる素材（Issue #178）', () => {
  it('渡した id を持つ。入れた直後にその素材を選ぶのに使う', () => {
    const clip = newInsertedClip({ id: 'new-1', asset: jingle, at: { timeline: smp(0), voice } });
    expect(clip.id).toBe('new-1');
    expect(clip.assetId).toBe('a1');
    expect(clip.gainDb).toBe(-3);
  });

  it('声の上なら、その発言に付ける（カットに追従する）', () => {
    const clip = newInsertedClip({ id: 'x', asset: jingle, at: { timeline: smp(2000), voice } });
    expect(clip.anchor).toEqual({ type: 'source', takeId: 'T1', srcSmp: 3000 });
  });

  it('声の末尾より後なら、絶対位置にする', () => {
    const clip = newInsertedClip({ id: 'x', asset: jingle, at: { timeline: smp(48000), voice } });
    expect(clip.anchor).toEqual({ type: 'timeline_abs', smp: 48000 });
  });

  it('録音中は、録っているテイクの位置に付ける', () => {
    const clip = newInsertedClip({
      id: 'x',
      asset: jingle,
      at: { takeId: 'T2', srcSmp: smp(9600) },
    });
    expect(clip.anchor).toEqual({ type: 'source', takeId: 'T2', srcSmp: 9600 });
  });

  it('BGM は繰り返して最後まで鳴らす。ほかは素材の終わりまで', () => {
    const bgm = newInsertedClip({
      id: 'x',
      asset: { ...jingle, kind: 'bgm' },
      at: { timeline: smp(0), voice },
    });
    expect(bgm).toMatchObject({ loop: true, endMode: 'timeline_end' });
    const j = newInsertedClip({ id: 'x', asset: jingle, at: { timeline: smp(0), voice } });
    expect(j).toMatchObject({ loop: false, endMode: 'asset_end' });
  });
});
