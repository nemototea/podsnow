import { DEFAULT_DUCKING, DEFAULT_LOUDNESS } from '@/domain/render/types';

import { soundAffectsPlayback, type SoundSettings } from '../renderDocumentFromDb';

const base: SoundSettings = { loudness: DEFAULT_LOUDNESS, ducking: DEFAULT_DUCKING };

describe('soundAffectsPlayback', () => {
  // Issue #134: 書き出しタブでダッキングを変えても試聴に反映されなかった
  it('is true when ducking changes', () => {
    expect(
      soundAffectsPlayback(base, { ...base, ducking: { ...DEFAULT_DUCKING, enabled: false } }),
    ).toBe(true);
    expect(
      soundAffectsPlayback(base, { ...base, ducking: { ...DEFAULT_DUCKING, depthDb: -20 } }),
    ).toBe(true);
    expect(
      soundAffectsPlayback(base, { ...base, ducking: { ...DEFAULT_DUCKING, attackMs: 100 } }),
    ).toBe(true);
    expect(
      soundAffectsPlayback(base, { ...base, ducking: { ...DEFAULT_DUCKING, releaseMs: 800 } }),
    ).toBe(true);
  });

  // ラウドネス正規化は書き出し時だけかかる。試聴を読み直して音を途切れさせない
  it('is false when only loudness changes', () => {
    expect(
      soundAffectsPlayback(base, { ...base, loudness: { ...DEFAULT_LOUDNESS, enabled: false } }),
    ).toBe(false);
    expect(
      soundAffectsPlayback(base, { ...base, loudness: { ...DEFAULT_LOUDNESS, targetLufs: -14 } }),
    ).toBe(false);
  });

  it('is false when nothing changes', () => {
    expect(soundAffectsPlayback(base, { ...base })).toBe(false);
  });
});
