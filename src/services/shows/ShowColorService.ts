import { pickDominantColor } from '@/domain/color/dominantColor';
import type { SqlExecutor } from '@/infra/db/executor';
import { getShow, updateShow } from '@/infra/db/repositories/showsRepo';
import type { FsPort } from '@/infra/files/fsPort';
import { joinRoot } from '@/infra/files/layout';

import type { ImageProcessorPort } from './ImageProcessorPort';

/** 代表色を取るときに縮める大きさ（DESIGN_SYSTEM.md §2.6）。 */
export const SAMPLE_SIZE = 16;

export interface ShowColorDeps {
  db: SqlExecutor;
  fs: FsPort;
  imageProcessor: ImageProcessorPort;
  root: string;
  now: () => number;
}

function filePath(uri: string): string {
  return uri.startsWith('file://') ? decodeURI(uri.slice('file://'.length)) : uri;
}

/**
 * 番組のアートワークの代表色（`shows.cover_color`）を計算して保存する（Issue #235、DESIGN_SYSTEM.md §2.6）。
 * 画像を 16×16 に縮めて端末内で計算し、外部に送らない（NFR-2）。番組の色の計算は UI が
 * `deriveShowColors` で行うので、ここは代表色を 1 つ持つだけ。
 */
export class ShowColorService {
  private readonly pending = new Map<string, Promise<string | null>>();

  constructor(private readonly deps: ShowColorDeps) {}

  /**
   * 代表色を返す。アートワークがあってまだ計算していなければ、計算して保存する。
   * アートワークが無い、または計算に失敗したら null（番組の色は既定の色になる）。
   */
  ensure(showId: string): Promise<string | null> {
    const running = this.pending.get(showId);
    if (running) return running;
    const job = this.compute(showId).finally(() => this.pending.delete(showId));
    this.pending.set(showId, job);
    return job;
  }

  private async compute(showId: string): Promise<string | null> {
    const show = await getShow(this.deps.db, showId);
    if (!show?.cover_path) return null;
    if (show.cover_color) return show.cover_color;
    let sampled: { rgba: Uint8Array; uri: string } | null = null;
    try {
      sampled = await this.deps.imageProcessor.samplePixels(
        encodeURI(`file://${joinRoot(this.deps.root, show.cover_path)}`),
        SAMPLE_SIZE,
      );
      const color = pickDominantColor(sampled.rgba);
      if (!color) return null;
      // 計算している間に画像が替わっていたら保存しない（次の ensure で計算し直す）
      const now = await getShow(this.deps.db, showId);
      if (now?.cover_path !== show.cover_path) return null;
      await updateShow(this.deps.db, showId, { coverColor: color }, this.deps.now());
      return color;
    } catch {
      // 代表色は見た目のためだけの値。取れなくても番組の操作は止めない。
      return null;
    } finally {
      if (sampled) {
        try {
          this.deps.fs.delete(filePath(sampled.uri));
        } catch {
          // 一時ファイルの掃除は best effort
        }
      }
    }
  }
}
