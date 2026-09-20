import type { SqlExecutor } from '@/infra/db/executor';
import {
  insertAsset,
  listAssets,
  softDeleteAsset,
  updateAsset,
  type AssetKind,
  type AssetRow,
} from '@/infra/db/repositories/assetsRepo';
import { joinRoot, relPaths } from '@/infra/files/layout';

import type { AudioEnginePort } from '../audio/AudioEnginePort';
import { PEAKS_PER_SECOND } from '../audio/PeaksService';

export interface AssetsDeps {
  db: SqlExecutor;
  engine: AudioEnginePort;
  root: string;
  ensureDir: (absDir: string) => void;
  newId: () => string;
  now: () => number;
}

const DEFAULT_GAIN: Record<AssetKind, number> = {
  opening: -2,
  ending: -2,
  jingle: -4,
  sfx: -6,
  bgm: -14,
};

/** Show Assets の取り込み・一覧・更新（FR-AST-1〜3）。取り込み時に 48 kHz WAV へ変換しピークも生成する。 */
export class AssetsService {
  constructor(private readonly deps: AssetsDeps) {}

  list(showId: string): Promise<AssetRow[]> {
    return listAssets(this.deps.db, showId);
  }

  async import(
    showId: string,
    kind: AssetKind,
    srcAbsPath: string,
    name: string,
    originalFilename: string | null,
  ): Promise<AssetRow> {
    const id = this.deps.newId();
    const rel = relPaths.assetFile(showId, id);
    const abs = joinRoot(this.deps.root, rel);
    this.deps.ensureDir(joinRoot(this.deps.root, `${relPaths.showDir(showId)}/assets`));
    const r = await this.deps.engine.importAsset(srcAbsPath, abs, {
      sampleRate: 48000,
      channels: 1,
    });
    const peaksRel = relPaths.assetPeaks(showId, id);
    await this.deps.engine.generatePeaks(abs, joinRoot(this.deps.root, peaksRel), PEAKS_PER_SECOND);
    await insertAsset(this.deps.db, {
      id,
      showId,
      kind,
      name,
      path: rel,
      originalFilename,
      durationSmp: r.frames,
      sampleRate: r.sampleRate,
      channels: r.channels,
      defaultGainDb: DEFAULT_GAIN[kind],
      now: this.deps.now(),
    });
    await updateAsset(this.deps.db, id, { peaksPath: peaksRel }, this.deps.now());
    const rows = await listAssets(this.deps.db, showId);
    return rows.find((a) => a.id === id)!;
  }

  async rename(id: string, name: string): Promise<void> {
    await updateAsset(this.deps.db, id, { name }, this.deps.now());
  }

  async setFavorite(id: string, isFavorite: boolean): Promise<void> {
    await updateAsset(this.deps.db, id, { isFavorite }, this.deps.now());
  }

  async reorder(ids: readonly string[]): Promise<void> {
    await this.deps.db.transaction(async () => {
      let i = 0;
      for (const id of ids)
        await updateAsset(this.deps.db, id, { sortOrder: i++ }, this.deps.now());
    });
  }

  /** 論理削除。ファイルは残す（既存エピソードが参照している可能性があるため）。 */
  async remove(id: string): Promise<void> {
    await softDeleteAsset(this.deps.db, id, this.deps.now());
  }
}
