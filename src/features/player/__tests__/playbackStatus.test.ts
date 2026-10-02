import { smp } from '@/domain/time';
import type { PlaybackSource } from '@/services/audio/PlaybackService';

import { samePlaybackStatus } from '../playbackStatus';

const exp = (exportId: string): PlaybackSource => ({
  kind: 'export',
  homeKey: 'ep-1',
  episodeId: 'ep-1',
  exportId,
  title: 't',
  episodeNumber: 1,
  duration: smp(48000),
});

describe('samePlaybackStatus', () => {
  it('同じ再生元・同じ再生状態なら同じ（別オブジェクトでも）', () => {
    expect(
      samePlaybackStatus(
        { source: exp('x1'), playing: true },
        { source: exp('x1'), playing: true },
      ),
    ).toBe(true);
    expect(
      samePlaybackStatus(
        { source: { kind: 'timeline', episodeId: 'a' }, playing: false },
        { source: { kind: 'timeline', episodeId: 'a' }, playing: false },
      ),
    ).toBe(true);
    expect(
      samePlaybackStatus({ source: null, playing: false }, { source: null, playing: false }),
    ).toBe(true);
  });

  it('再生中かが変われば違う', () => {
    expect(
      samePlaybackStatus(
        { source: exp('x1'), playing: true },
        { source: exp('x1'), playing: false },
      ),
    ).toBe(false);
  });

  it('再生元が変われば違う', () => {
    expect(
      samePlaybackStatus(
        { source: exp('x1'), playing: true },
        { source: exp('x2'), playing: true },
      ),
    ).toBe(false);
    expect(
      samePlaybackStatus({ source: null, playing: false }, { source: exp('x1'), playing: false }),
    ).toBe(false);
    expect(
      samePlaybackStatus(
        { source: { kind: 'timeline', episodeId: 'a' }, playing: false },
        { source: { kind: 'timeline', episodeId: 'b' }, playing: false },
      ),
    ).toBe(false);
  });
});
