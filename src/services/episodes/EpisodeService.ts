import type { EditableDoc } from '@/domain/editing/doc';
import { renderTemplate } from '@/domain/metadata/template';
import { smp, ZERO_SMP } from '@/domain/time';
import type { OverlayClip } from '@/domain/timeline/types';
import type { SqlExecutor } from '@/infra/db/executor';
import { getAsset } from '@/infra/db/repositories/assetsRepo';
import { loadDoc, saveDoc } from '@/infra/db/repositories/editableDocRepo';
import {
  getContinueEpisode,
  getEpisode,
  insertEpisode,
  listEpisodes,
  restoreEpisode,
  softDeleteEpisode,
  updateEpisode,
  type EpisodeListItem,
  type EpisodeRow,
} from '@/infra/db/repositories/episodesRepo';
import { getDefaultTemplate, getLayout, getShow } from '@/infra/db/repositories/showsRepo';
import { listTakes } from '@/infra/db/repositories/takesRepo';

import type { ServiceLabels } from '../app/labels';

export interface EpisodeDeps {
  db: SqlExecutor;
  newId: () => string;
  now: () => number;
  /** 既定タイトルなど、DB に書き込む文言。UI 層が i18n から渡す（Issue #80）。 */
  labels: () => ServiceLabels;
}

/** Episode の作成（Show の既定構成とテンプレート適用）・一覧・状態判定（FR-EP-2〜4）。 */
export class EpisodeService {
  constructor(private readonly deps: EpisodeDeps) {}

  list(showId: string): Promise<EpisodeListItem[]> {
    return listEpisodes(this.deps.db, showId);
  }

  get(id: string): Promise<EpisodeRow | null> {
    return getEpisode(this.deps.db, id);
  }

  continueCandidate(showId: string): Promise<EpisodeListItem | null> {
    return getContinueEpisode(this.deps.db, showId);
  }

  /** 新規エピソード。話数を採番し、Opening / Ending / BGM を配置し、概要欄テンプレートを適用する。 */
  async create(showId: string): Promise<EpisodeRow> {
    const { db, newId, now } = this.deps;
    const show = await getShow(db, showId);
    if (!show) throw new Error('show not found');
    const layout = await getLayout(db, showId);
    const template = await getDefaultTemplate(db, showId);
    const id = newId();
    const t = now();
    const episodeNumber = show.next_episode_number;
    const title = this.deps.labels().episodeTitle(episodeNumber);
    const description = template
      ? renderTemplate(template.body, {
          title,
          episodeNumber,
          season: show.default_season,
          topics: [],
          showName: show.name,
        })
      : '';
    await db.transaction(async () => {
      await insertEpisode(db, {
        id,
        showId,
        title,
        description,
        episodeNumber,
        season: show.default_season,
        now: t,
      });
      await db.run('UPDATE shows SET next_episode_number = ?, updated_at = ? WHERE id = ?', [
        episodeNumber + 1,
        t,
        showId,
      ]);
      const overlays: OverlayClip[] = [];
      const base = {
        srcStart: ZERO_SMP,
        srcEnd: null,
        fadeIn: ZERO_SMP,
        fadeOut: ZERO_SMP,
      } as const;
      if (layout.opening_asset_id && (await getAsset(db, layout.opening_asset_id))) {
        overlays.push({
          ...base,
          id: newId(),
          assetId: layout.opening_asset_id,
          kind: 'opening',
          anchor: { type: 'timeline_start', offset: ZERO_SMP },
          gainDb: layout.opening_gain_db,
          duck: false,
          loop: false,
          endMode: 'asset_end',
        });
      }
      if (layout.ending_asset_id && (await getAsset(db, layout.ending_asset_id))) {
        overlays.push({
          ...base,
          id: newId(),
          assetId: layout.ending_asset_id,
          kind: 'ending',
          anchor: { type: 'timeline_end', offset: ZERO_SMP },
          gainDb: layout.ending_gain_db,
          duck: false,
          loop: false,
          endMode: 'asset_end',
        });
      }
      if (layout.bgm_asset_id && (await getAsset(db, layout.bgm_asset_id))) {
        overlays.push({
          ...base,
          id: newId(),
          assetId: layout.bgm_asset_id,
          kind: 'bgm',
          anchor: { type: 'timeline_start', offset: ZERO_SMP },
          gainDb: layout.bgm_gain_db,
          fadeIn: smp(48000),
          fadeOut: smp(96000),
          duck: true,
          loop: true,
          endMode: 'timeline_end',
        });
      }
      const doc: EditableDoc = { voice: [], overlays, markers: [] };
      await saveDoc(db, id, doc, t);
    });
    return (await getEpisode(db, id))!;
  }

  async touch(id: string): Promise<void> {
    await updateEpisode(this.deps.db, id, { lastOpenedAt: this.deps.now() }, this.deps.now());
  }

  async update(id: string, patch: Parameters<typeof updateEpisode>[2]): Promise<void> {
    await updateEpisode(this.deps.db, id, patch, this.deps.now());
  }

  /** 状態の自動判定（FR-EP-3）: exported は書き出し完了時に付く。声があれば ready、無ければ draft。 */
  async refreshStatus(id: string): Promise<void> {
    const ep = await getEpisode(this.deps.db, id);
    if (!ep || ep.status === 'exported') return;
    const doc = await loadDoc(this.deps.db, id);
    const status = doc.voice.length > 0 ? 'ready' : 'draft';
    if (status !== ep.status) await updateEpisode(this.deps.db, id, { status }, this.deps.now());
  }

  /** 論理削除（Undo 可。元の録音ファイルは残る）。 */
  async remove(id: string): Promise<void> {
    await softDeleteEpisode(this.deps.db, id, this.deps.now());
  }

  async restore(id: string): Promise<void> {
    await restoreEpisode(this.deps.db, id, this.deps.now());
  }

  /** 複製して新しい回にする: メタデータとオーバーレイ・トークテーマを引き継ぎ、録音は引き継がない。 */
  async duplicate(id: string): Promise<EpisodeRow> {
    const src = await getEpisode(this.deps.db, id);
    if (!src) throw new Error('episode not found');
    const created = await this.create(src.show_id);
    const doc = await loadDoc(this.deps.db, id);
    await this.deps.db.transaction(async () => {
      await updateEpisode(
        this.deps.db,
        created.id,
        { description: src.description, season: src.season, soundSettings: src.sound_settings },
        this.deps.now(),
      );
      await saveDoc(
        this.deps.db,
        created.id,
        {
          voice: [],
          markers: [],
          overlays: doc.overlays
            .filter((o) => o.anchor.type !== 'source')
            .map((o) => ({ ...o, id: this.deps.newId() })),
        },
        this.deps.now(),
      );
      const topics = await this.deps.db.all<{ position: number; text: string }>(
        'SELECT position, text FROM topics WHERE episode_id = ? ORDER BY position',
        [id],
      );
      for (const tp of topics) {
        await this.deps.db.run(
          'INSERT INTO topics (id, episode_id, position, text) VALUES (?,?,?,?)',
          [this.deps.newId(), created.id, tp.position, tp.text],
        );
      }
    });
    return (await getEpisode(this.deps.db, created.id))!;
  }

  listTakes(episodeId: string) {
    return listTakes(this.deps.db, episodeId);
  }
}
