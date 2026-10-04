import { DEFAULT_DUCKING, DEFAULT_LOUDNESS } from '@/domain/render/types';

import { timelineSoundJson, type SoundSettings } from '../renderDocumentFromDb';

const base: SoundSettings = { loudness: DEFAULT_LOUDNESS, ducking: DEFAULT_DUCKING };

describe('timelineSoundJson (Issue #158)', () => {
  it('sends ducking and loudness with the solved gain', () => {
    expect(JSON.parse(timelineSoundJson(base, -3.5))).toEqual({
      ducking: DEFAULT_DUCKING,
      loudness: { ...DEFAULT_LOUDNESS, gainDb: -3.5 },
    });
  });

  // 未測定は gainDb を送らない（ネイティブは調整なしで鳴らす）
  it('omits the gain while it is unknown', () => {
    expect(JSON.parse(timelineSoundJson(base, null))).toEqual({
      ducking: DEFAULT_DUCKING,
      loudness: DEFAULT_LOUDNESS,
    });
  });
});
