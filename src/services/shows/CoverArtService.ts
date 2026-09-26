import { AppError } from '@/domain/errors';
import type { SqlExecutor } from '@/infra/db/executor';
import { getShow, updateShow } from '@/infra/db/repositories/showsRepo';
import type { FsPort } from '@/infra/files/fsPort';
import { joinRoot, relPaths } from '@/infra/files/layout';

import type { ImageProcessorPort } from './ImageProcessorPort';
import type { ImagePickerPort, PickedImage } from './ImagePickerPort';

const MAX_COVER_PIXELS = 3000;
const COPY_CHUNK_BYTES = 64 * 1024;

export interface CoverArtDeps {
  db: SqlExecutor;
  fs: FsPort;
  imagePicker: ImagePickerPort;
  imageProcessor: ImageProcessorPort;
  root: string;
  newId: () => string;
  now: () => number;
}

function filePath(uri: string): string {
  return uri.startsWith('file://') ? decodeURI(uri.slice('file://'.length)) : uri;
}

function copyFile(fs: FsPort, source: string, destination: string): void {
  const input = fs.open(source, 'r');
  let output: ReturnType<FsPort['open']> | null = null;
  try {
    output = fs.open(destination, 'w');
    for (;;) {
      const bytes = input.read(COPY_CHUNK_BYTES);
      if (!bytes.length) break;
      output.write(bytes);
    }
  } finally {
    input.close();
    output?.close();
  }
}

/**
 * 番組アートワークの正規化・保存・削除。
 * 新ファイル → DB → 旧ファイルの順で確定し、途中失敗で現在の画像を失わない。
 */
export class CoverArtService {
  constructor(private readonly deps: CoverArtDeps) {}

  uri(relativePath: string | null): string | null {
    return relativePath ? encodeURI(`file://${joinRoot(this.deps.root, relativePath)}`) : null;
  }

  async pickAndSet(showId: string): Promise<boolean> {
    let source: PickedImage | null;
    try {
      source = await this.deps.imagePicker.pickSquare();
    } catch (cause) {
      throw new AppError('cover_processing_failed', {}, cause);
    }
    if (!source) return false;
    await this.set(showId, source);
    return true;
  }

  async set(
    showId: string,
    source: { uri: string; width: number; height: number },
  ): Promise<string> {
    if (source.width <= 0 || source.height <= 0) throw new AppError('cover_processing_failed');
    const current = await getShow(this.deps.db, showId);
    if (!current) throw new AppError('cover_processing_failed');

    let normalized: Awaited<ReturnType<ImageProcessorPort['normalizeSquareJpeg']>> | null = null;
    const rel = relPaths.coverFile(showId, `${this.deps.now()}-${this.deps.newId()}`, 'jpg');
    const destination = joinRoot(this.deps.root, rel);
    try {
      normalized = await this.deps.imageProcessor.normalizeSquareJpeg(source, MAX_COVER_PIXELS);
      this.deps.fs.ensureDir(joinRoot(this.deps.root, relPaths.showDir(showId)));
      copyFile(this.deps.fs, filePath(normalized.uri), destination);
      await updateShow(
        this.deps.db,
        showId,
        { coverPath: rel, coverSourceUrl: null },
        this.deps.now(),
      );
    } catch (cause) {
      try {
        this.deps.fs.delete(destination);
      } catch {
        // DB が旧パスを指したままなら、新しい孤立ファイルは次回掃除でも回収できる。
      }
      throw new AppError('cover_processing_failed', {}, cause);
    } finally {
      if (normalized) {
        try {
          this.deps.fs.delete(filePath(normalized.uri));
        } catch {
          // ImageManipulator の cache 掃除失敗はユーザーデータの保存を失敗にしない。
        }
      }
    }

    if (current.cover_path && current.cover_path !== rel) {
      try {
        this.deps.fs.delete(joinRoot(this.deps.root, current.cover_path));
      } catch {
        // DB 確定後の古いファイル掃除は best effort。
      }
    }
    this.removeStale(showId, rel);
    return rel;
  }

  async remove(showId: string): Promise<void> {
    const current = await getShow(this.deps.db, showId);
    if (!current) throw new AppError('cover_processing_failed');
    await updateShow(
      this.deps.db,
      showId,
      { coverPath: null, coverSourceUrl: null },
      this.deps.now(),
    );
    if (current.cover_path) {
      try {
        this.deps.fs.delete(joinRoot(this.deps.root, current.cover_path));
      } catch {
        // DB は既に「画像なし」で確定済み。孤立ファイルは次回掃除で回収する。
      }
    }
    this.removeStale(showId, null);
  }

  private removeStale(showId: string, keep: string | null): void {
    try {
      const dir = joinRoot(this.deps.root, relPaths.showDir(showId));
      const keepName = keep?.split('/').pop() ?? null;
      for (const name of this.deps.fs.list(dir)) {
        if (/^cover[-.]/.test(name) && name !== keepName) this.deps.fs.delete(`${dir}/${name}`);
      }
    } catch {
      // 次の置き換え・削除で再試行する。
    }
  }
}
