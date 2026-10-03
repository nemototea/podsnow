import { smp, ZERO_SMP } from '../../time';
import type { OverlayClip, VoiceSegment } from '../../timeline/types';
import { renderFingerprint, type FingerprintSource } from '../fingerprint';
import { DEFAULT_DUCKING, DEFAULT_LOUDNESS } from '../types';

const seg = (id: string, a: number, b: number): VoiceSegment => ({
  id,
  takeId: 'A',
  srcStart: smp(a),
  srcEnd: smp(b),
  gainDb: 0,
  fadeIn: ZERO_SMP,
  fadeOut: ZERO_SMP,
});

const overlay = (id: string, assetId: string): OverlayClip => ({
  id,
  assetId,
  kind: 'opening',
  anchor: { type: 'timeline_start', offset: ZERO_SMP },
  srcStart: ZERO_SMP,
  srcEnd: null,
  gainDb: 0,
  fadeIn: ZERO_SMP,
  fadeOut: ZERO_SMP,
  duck: false,
  loop: false,
  endMode: 'asset_end',
});

const base = (more: Partial<FingerprintSource> = {}): FingerprintSource => ({
  voice: [seg('v1', 0, 1000), seg('v2', 2000, 3000)],
  overlays: [overlay('o1', 'op'), overlay('o2', 'ed')],
  sound: { loudness: DEFAULT_LOUDNESS, ducking: DEFAULT_DUCKING },
  ...more,
});

describe('renderFingerprint（Issue #168）', () => {
  it('同じ中身なら同じ値', () => {
    expect(renderFingerprint(base())).toBe(renderFingerprint(base()));
    expect(renderFingerprint(base())).toMatch(/^[0-9a-f]{28}$/);
  });

  it('行の id が違っても中身が同じなら同じ（取り消しで戻した・作り直した行）', () => {
    const renamed = base({
      voice: [seg('x1', 0, 1000), seg('x2', 2000, 3000)],
      overlays: [overlay('y1', 'op'), overlay('y2', 'ed')],
    });
    expect(renderFingerprint(renamed)).toBe(renderFingerprint(base()));
  });

  it('素材の並び順は問わない', () => {
    const swapped = base({ overlays: [overlay('o2', 'ed'), overlay('o1', 'op')] });
    expect(renderFingerprint(swapped)).toBe(renderFingerprint(base()));
  });

  it('キーの順が違っても同じ', () => {
    const reordered = base({
      sound: {
        ducking: { ...DEFAULT_DUCKING },
        loudness: {
          truePeakDbtp: DEFAULT_LOUDNESS.truePeakDbtp,
          targetLufs: DEFAULT_LOUDNESS.targetLufs,
          enabled: DEFAULT_LOUDNESS.enabled,
        },
      },
    });
    expect(renderFingerprint(reordered)).toBe(renderFingerprint(base()));
  });

  it('声の並び・範囲・音量が変われば変わる', () => {
    const fp = renderFingerprint(base());
    expect(
      renderFingerprint(base({ voice: [seg('v2', 2000, 3000), seg('v1', 0, 1000)] })),
    ).not.toBe(fp);
    expect(renderFingerprint(base({ voice: [seg('v1', 0, 1000)] }))).not.toBe(fp);
    expect(renderFingerprint(base({ voice: [seg('v1', 0, 999), seg('v2', 2000, 3000)] }))).not.toBe(
      fp,
    );
    expect(
      renderFingerprint(
        base({ voice: [{ ...seg('v1', 0, 1000), gainDb: -3 }, seg('v2', 2000, 3000)] }),
      ),
    ).not.toBe(fp);
  });

  it('素材を外す・音の仕上げを変えると変わる', () => {
    const fp = renderFingerprint(base());
    expect(renderFingerprint(base({ overlays: [overlay('o1', 'op')] }))).not.toBe(fp);
    expect(
      renderFingerprint(
        base({
          sound: { loudness: { ...DEFAULT_LOUDNESS, enabled: false }, ducking: DEFAULT_DUCKING },
        }),
      ),
    ).not.toBe(fp);
    expect(
      renderFingerprint(
        base({
          sound: { loudness: DEFAULT_LOUDNESS, ducking: { ...DEFAULT_DUCKING, depthDb: -6 } },
        }),
      ),
    ).not.toBe(fp);
  });
});
