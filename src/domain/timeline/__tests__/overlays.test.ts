import { smp, ZERO_SMP } from '../../time';
import { placeOverlay, placeOverlays, suggestReanchor } from '../overlays';
import type { OverlayClip, VoiceSegment } from '../types';
import { deleteRange } from '../voice';

const seg = (id: string, takeId: string, a: number, b: number): VoiceSegment => ({
  id,
  takeId,
  srcStart: smp(a),
  srcEnd: smp(b),
  gainDb: 0,
  fadeIn: ZERO_SMP,
  fadeOut: ZERO_SMP,
});
const voice = [seg('a', 'A', 0, 1000), seg('b', 'B', 0, 500)];

const clip = (over: Partial<OverlayClip>): OverlayClip => ({
  id: 'o',
  assetId: 'asset',
  kind: 'jingle',
  anchor: { type: 'timeline_abs', smp: ZERO_SMP },
  srcStart: ZERO_SMP,
  srcEnd: null,
  gainDb: 0,
  fadeIn: ZERO_SMP,
  fadeOut: ZERO_SMP,
  duck: false,
  loop: false,
  endMode: 'asset_end',
  ...over,
});

describe('placeOverlay', () => {
  it('source anchor follows the take position through cuts', () => {
    const c = clip({ anchor: { type: 'source', takeId: 'A', srcSmp: smp(700) } });
    expect(placeOverlay(voice, c, smp(100))).toMatchObject({
      status: 'placed',
      range: { start: 700, end: 800 },
    });
    const cut = deleteRange(voice, smp(100), smp(300));
    expect(placeOverlay(cut, c, smp(100))).toMatchObject({
      status: 'placed',
      range: { start: 500, end: 600 },
    });
  });
  it('source anchor becomes orphaned when its position is cut', () => {
    const c = clip({ anchor: { type: 'source', takeId: 'A', srcSmp: smp(200) } });
    const cut = deleteRange(voice, smp(100), smp(300));
    expect(placeOverlay(cut, c, smp(100))).toMatchObject({ status: 'orphaned' });
  });
  it('timeline_start / timeline_end follow total duration', () => {
    const op = clip({ kind: 'opening', anchor: { type: 'timeline_start', offset: ZERO_SMP } });
    const ed = clip({ kind: 'ending', anchor: { type: 'timeline_end', offset: ZERO_SMP } });
    expect(placeOverlay(voice, op, smp(100))).toMatchObject({ range: { start: 0, end: 100 } });
    expect(placeOverlay(voice, ed, smp(100))).toMatchObject({ range: { start: 1400, end: 1500 } });
    const cut = deleteRange(voice, smp(0), smp(500));
    expect(placeOverlay(cut, ed, smp(100))).toMatchObject({ range: { start: 900, end: 1000 } });
  });
  it('bgm with timeline_end + loop spans to the end of the voice track', () => {
    const bgm = clip({
      kind: 'bgm',
      anchor: { type: 'timeline_abs', smp: smp(100) },
      endMode: 'timeline_end',
      loop: true,
    });
    expect(placeOverlay(voice, bgm, smp(60))).toMatchObject({ range: { start: 100, end: 1500 } });
  });
  it('respects srcStart/srcEnd trimming and fixed duration', () => {
    const t = clip({ srcStart: smp(10), srcEnd: smp(40) });
    expect(placeOverlay(voice, t, smp(100))).toMatchObject({ range: { start: 0, end: 30 } });
    const f = clip({ endMode: 'fixed', fixedDuration: smp(7) });
    expect(placeOverlay(voice, f, smp(100))).toMatchObject({ range: { start: 0, end: 7 } });
  });
  it('placeOverlays marks unknown assets as orphaned', () => {
    const out = placeOverlays(voice, [clip({ assetId: 'missing' })], new Map());
    expect(out[0]!.status).toBe('orphaned');
  });
});

describe('suggestReanchor', () => {
  it('proposes the nearest surviving position of the same take', () => {
    const c = clip({ anchor: { type: 'source', takeId: 'A', srcSmp: smp(250) } });
    const cut = deleteRange(voice, smp(200), smp(300));
    const s = suggestReanchor(voice, cut, c);
    expect(s?.anchor).toEqual({ type: 'source', takeId: 'A', srcSmp: 300 });
  });
  it('returns null when the anchor is still alive or not a source anchor', () => {
    const c = clip({ anchor: { type: 'source', takeId: 'A', srcSmp: smp(50) } });
    expect(suggestReanchor(voice, deleteRange(voice, smp(200), smp(300)), c)).toBeNull();
    expect(suggestReanchor(voice, voice, clip({}))).toBeNull();
  });
});
