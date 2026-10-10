import { smp, ZERO_SMP } from '../../time';
import type { OverlayClip, VoiceSegment } from '../../timeline/types';
import {
  buildRenderDocument,
  expandVoiceSegment,
  outputOrigin,
  type TakeFile,
} from '../buildRenderDocument';
import { DEFAULT_DUCKING, DEFAULT_LOUDNESS } from '../types';

const seg = (
  id: string,
  takeId: string,
  a: number,
  b: number,
  extra: Partial<VoiceSegment> = {},
): VoiceSegment => ({
  id,
  takeId,
  srcStart: smp(a),
  srcEnd: smp(b),
  gainDb: 0,
  fadeIn: ZERO_SMP,
  fadeOut: ZERO_SMP,
  ...extra,
});

// Take A は 2 つの Segment ファイル（0..1000, 1000..1500）
const files: TakeFile[] = [
  { takeId: 'A', offset: 0, duration: 1000, path: '/a/seg-0001.wav' },
  { takeId: 'A', offset: 1000, duration: 500, path: '/a/seg-0002.wav' },
  { takeId: 'B', offset: 0, duration: 300, path: '/b/seg-0001.wav' },
];

describe('expandVoiceSegment', () => {
  it('splits a segment spanning two files and keeps fades on the outer edges', () => {
    const out = expandVoiceSegment(
      seg('a', 'A', 800, 1200, { fadeIn: smp(10), fadeOut: smp(20) }),
      5000,
      files,
    );
    expect(out).toEqual([
      {
        path: '/a/seg-0001.wav',
        fileStart: 800,
        fileEnd: 1000,
        tlStart: 5000,
        gainDb: 0,
        fadeInFrames: 10,
        fadeOutFrames: 0,
      },
      {
        path: '/a/seg-0002.wav',
        fileStart: 0,
        fileEnd: 200,
        tlStart: 5200,
        gainDb: 0,
        fadeInFrames: 0,
        fadeOutFrames: 20,
      },
    ]);
  });
  it('returns nothing for a take with no files', () => {
    expect(expandVoiceSegment(seg('z', 'Z', 0, 10), 0, files)).toEqual([]);
  });
});

describe('buildRenderDocument', () => {
  it('builds absolute-positioned clips and overlays, dropping orphaned overlays', () => {
    const overlays: OverlayClip[] = [
      {
        id: 'o1',
        assetId: 'J',
        kind: 'jingle',
        anchor: { type: 'source', takeId: 'A', srcSmp: smp(1100) },
        srcStart: ZERO_SMP,
        srcEnd: null,
        gainDb: -4,
        fadeIn: ZERO_SMP,
        fadeOut: ZERO_SMP,
        loop: false,
        endMode: 'asset_end',
      },
      {
        id: 'o2',
        assetId: 'J',
        kind: 'jingle',
        anchor: { type: 'source', takeId: 'A', srcSmp: smp(50) }, // カット済み
        srcStart: ZERO_SMP,
        srcEnd: null,
        gainDb: 0,
        fadeIn: ZERO_SMP,
        fadeOut: ZERO_SMP,
        loop: false,
        endMode: 'asset_end',
      },
      {
        id: 'bgm',
        assetId: 'M',
        kind: 'bgm',
        anchor: { type: 'timeline_start', offset: ZERO_SMP },
        srcStart: ZERO_SMP,
        srcEnd: null,
        gainDb: -14,
        fadeIn: smp(5),
        fadeOut: smp(5),
        loop: true,
        endMode: 'timeline_end',
      },
    ];
    const doc = buildRenderDocument({
      sampleRate: 48000,
      channels: 1,
      voice: [seg('b', 'B', 0, 300), seg('a', 'A', 100, 1200)],
      overlays,
      takeFiles: files,
      assets: [
        { assetId: 'J', path: '/assets/J.wav', duration: smp(100) },
        { assetId: 'M', path: '/assets/M.wav', duration: smp(60) },
      ],
      ducking: DEFAULT_DUCKING,
      loudness: DEFAULT_LOUDNESS,
    });
    expect(doc.totalFrames).toBe(300 + 1100);
    expect(doc.voice.map((c) => [c.path, c.fileStart, c.fileEnd, c.tlStart])).toEqual([
      ['/b/seg-0001.wav', 0, 300, 0],
      ['/a/seg-0001.wav', 100, 1000, 300],
      ['/a/seg-0002.wav', 0, 200, 1200],
    ]);
    expect(doc.overlays).toHaveLength(2);
    expect(doc.overlays[0]).toMatchObject({
      path: '/assets/J.wav',
      tlStart: 300 + 1000,
      tlEnd: 1400,
      gainDb: -4,
      // 声に合わせて下げるのは BGM だけ（Issue #174）
      duck: false,
    });
    expect(doc.overlays[1]).toMatchObject({
      path: '/assets/M.wav',
      tlStart: 0,
      tlEnd: 1400,
      loop: true,
      duck: true,
    });
  });
});

describe('本編の前に素材があるとき（Issue #254）', () => {
  const base = {
    id: 'x',
    srcStart: ZERO_SMP,
    srcEnd: null,
    gainDb: 0,
    fadeIn: ZERO_SMP,
    fadeOut: ZERO_SMP,
    loop: false,
    endMode: 'asset_end',
  } as const;
  const overlays: OverlayClip[] = [
    {
      ...base,
      id: 'op',
      assetId: 'O',
      kind: 'opening',
      anchor: { type: 'timeline_start', offset: smp(-200) },
    },
    {
      ...base,
      id: 'ed',
      assetId: 'E',
      kind: 'ending',
      anchor: { type: 'timeline_end', offset: smp(150) },
    },
  ];
  const assets = [
    { assetId: 'O', path: '/assets/O.wav', duration: smp(200) },
    { assetId: 'E', path: '/assets/E.wav', duration: smp(150) },
  ];
  it('いちばん前を 0 に合わせて全体をずらし、エンディングの終わりまでを長さにする', () => {
    const doc = buildRenderDocument({
      sampleRate: 48000,
      channels: 1,
      voice: [seg('b', 'B', 0, 300)],
      overlays,
      takeFiles: files,
      assets,
      ducking: DEFAULT_DUCKING,
      loudness: DEFAULT_LOUDNESS,
    });
    expect(doc.totalFrames).toBe(200 + 300 + 150);
    expect(doc.voice[0]).toMatchObject({ tlStart: 200 });
    expect(doc.overlays.map((o) => [o.path, o.tlStart, o.tlEnd])).toEqual([
      ['/assets/O.wav', 0, 200],
      ['/assets/E.wav', 500, 650],
    ]);
    expect(
      outputOrigin(
        [seg('b', 'B', 0, 300)],
        overlays,
        new Map(assets.map((a) => [a.assetId, a.duration])),
      ),
    ).toBe(200);
  });
});
