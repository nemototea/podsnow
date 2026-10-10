import type { PodcastCategory } from '@/domain/podcast/feed';
import type { SqlExecutor } from '@/infra/db/executor';
import {
  getDefaultTemplate,
  getLayout,
  getShow,
  listCategories,
  replaceCategories,
  updateLayout,
  updateShow,
  updateTemplate,
  type ShowLayoutRow,
  type ShowRow,
  type TemplateRow,
} from '@/infra/db/repositories/showsRepo';

/** 番組画面が読む番組情報（FR-SHOW-3、FR-SHOW-3a）。 */
export interface ShowInfo {
  show: ShowRow;
  /** `itunes:category` の並び。先頭が主カテゴリー（DATA_MODEL.md §4.1.1）。 */
  categories: PodcastCategory[];
}

/** 番組情報の編集シートで書き換える項目。渡したものだけを書く。 */
export interface ShowInfoPatch {
  name: string;
  description: string;
  author: string;
  websiteUrl: string;
  language: string;
  explicit: boolean;
  /** 渡したら丸ごと置き換える（`replaceCategories`）。 */
  categories: readonly PodcastCategory[];
}

export type ShowLayoutPatch = Parameters<typeof updateLayout>[2];

/**
 * 番組の情報・既定の構成・概要欄テンプレートの読み書き（Issue #259）。
 * 画面（`src/app/show/`、`src/features/`）はここを通して番組の DB に触る（AGENTS.md、ARCHITECTURE.md §2）。
 * 書いたあとに `AppServices.show` を最新にするのは呼び出し側（`reloadShow`）。
 */
export class ShowService {
  constructor(private readonly deps: { db: SqlExecutor; newId: () => string; now: () => number }) {}

  async getInfo(showId: string): Promise<ShowInfo | null> {
    const { db } = this.deps;
    const [show, categories] = await Promise.all([getShow(db, showId), listCategories(db, showId)]);
    if (!show) return null;
    return {
      show,
      categories: categories.map((c) => ({ category: c.category, subcategory: c.subcategory })),
    };
  }

  /** 番組情報とカテゴリーを 1 つのトランザクションで書く（途中で落ちても片方だけ変わらない）。 */
  async updateInfo(showId: string, patch: Partial<ShowInfoPatch>): Promise<void> {
    const { db, newId, now } = this.deps;
    const { categories, ...fields } = patch;
    await db.transaction(async () => {
      await updateShow(db, showId, fields, now());
      if (categories) await replaceCategories(db, showId, categories, newId);
    });
  }

  getLayout(showId: string): Promise<ShowLayoutRow> {
    return getLayout(this.deps.db, showId);
  }

  updateLayout(showId: string, patch: ShowLayoutPatch): Promise<void> {
    return updateLayout(this.deps.db, showId, patch);
  }

  /** 概要欄テンプレート（既定の 1 件。FR-META-2）。 */
  getDescriptionTemplate(showId: string): Promise<TemplateRow | null> {
    return getDefaultTemplate(this.deps.db, showId);
  }

  updateDescriptionTemplate(templateId: string, body: string): Promise<void> {
    return updateTemplate(this.deps.db, templateId, body, this.deps.now());
  }
}
