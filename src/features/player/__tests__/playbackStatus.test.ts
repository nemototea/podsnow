import { smp } from '@/domain/time';
import type { PlaybackSource } from '@/services/audio/PlaybackService';

import { samePlaybackStatus, type PlaybackStatus } from '../playbackStatus';

const exp = (exportId: string): PlaybackSource => ({
  kind: 'export',
  homeKey: 'ep-1',
  episodeId: 'ep-1',
  exportId,
  title: 't',
  episodeNumber: 1,
  duration: smp(48000),
});

const st = (source: PlaybackSource | null, more: Partial<PlaybackStatus> = {}): PlaybackStatus => ({
  source,
  playing: false,
  loading: false,
  error: null,
  ...more,
});

describe('samePlaybackStatus', () => {
  it('同じ再生元・同じ状態なら同じ（別オブジェクトでも）', () => {
    expect(
      samePlaybackStatus(st(exp('x1'), { playing: true }), st(exp('x1'), { playing: true })),
    ).toBe(true);
    expect(
      samePlaybackStatus(
        st({ kind: 'timeline', episodeId: 'a' }),
        st({ kind: 'timeline', episodeId: 'a' }),
      ),
    ).toBe(true);
    expect(samePlaybackStatus(st(null), st(null))).toBe(true);
  });

  it('再生中か・読み込み中か・失敗が変われば違う', () => {
    expect(samePlaybackStatus(st(exp('x1'), { playing: true }), st(exp('x1')))).toBe(false);
    expect(samePlaybackStatus(st(exp('x1'), { loading: true }), st(exp('x1')))).toBe(false);
    expect(
      samePlaybackStatus(st(exp('x1'), { error: 'playback_file_failed' }), st(exp('x1'))),
    ).toBe(false);
  });

  it('再生元が変われば違う', () => {
    expect(samePlaybackStatus(st(exp('x1')), st(exp('x2')))).toBe(false);
    expect(samePlaybackStatus(st(null), st(exp('x1')))).toBe(false);
    expect(
      samePlaybackStatus(
        st({ kind: 'timeline', episodeId: 'a' }),
        st({ kind: 'timeline', episodeId: 'b' }),
      ),
    ).toBe(false);
  });
});
