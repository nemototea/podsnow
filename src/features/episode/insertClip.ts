import { ZERO_SMP, type Smp } from '@/domain/time';
import type { OverlayClip, VoiceSegment } from '@/domain/timeline/types';
import { resolveSource } from '@/domain/timeline/voice';
import type { AssetRow } from '@/infra/db/repositories/assetsRepo';

/**
 * 素材を入れるときの重ねる素材（DATA_MODEL.md §4.6）。位置は、声の上なら発言に付け（カットに追従）、
 * 声の外（末尾より後）なら絶対位置にする。録音中は、録っているテイクの位置を渡す。
 */
export function newInsertedClip(args: {
  id: string;
  asset: Pick<AssetRow, 'id' | 'kind' | 'default_gain_db'>;
  at: { takeId: string; srcSmp: Smp } | { timeline: Smp; voice: readonly VoiceSegment[] };
}): OverlayClip {
  const { id, asset, at } = args;
  let anchor: OverlayClip['anchor'];
  if ('takeId' in at) {
    anchor = { type: 'source', takeId: at.takeId, srcSmp: at.srcSmp };
  } else {
    const src = resolveSource(at.voice, at.timeline);
    anchor = src
      ? { type: 'source', takeId: src.takeId, srcSmp: src.srcSmp }
      : { type: 'timeline_abs', smp: at.timeline };
  }
  return {
    id,
    assetId: asset.id,
    kind: asset.kind,
    anchor,
    srcStart: ZERO_SMP,
    srcEnd: null,
    gainDb: asset.default_gain_db,
    fadeIn: ZERO_SMP,
    fadeOut: ZERO_SMP,
    loop: asset.kind === 'bgm',
    endMode: asset.kind === 'bgm' ? 'timeline_end' : 'asset_end',
  };
}
