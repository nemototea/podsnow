import { AppError } from '@/domain/errors';
import type { EditableDoc } from '@/domain/editing/doc';
import { renderTemplate } from '@/domain/metadata/template';
import { newItem } from '@/domain/outline';
import { smp, ZERO_SMP } from '@/domain/time';
import type { OverlayClip } from '@/domain/timeline/types';
import type { SqlExecutor } from '@/infra/db/executor';
import { getAsset } from '@/infra/db/repositories/assetsRepo';
import { loadDoc, saveDoc } from '@/infra/db/repositories/editableDocRepo';
import {
  getEpisode,
  insertEpisode,
  listEpisodes,
  markAudioPurged,
  nextEpisodeNumber,
  softDeleteEpisode,
  updateEpisode,
  type EpisodeListItem,
  type EpisodeRow,
} from '@/infra/db/repositories/episodesRepo';
import {
  listOutline,
  listShowTopicTemplate,
  saveOutline,
} from '@/infra/db/repositories/outlineRepo';
import { getDefaultTemplate, getLayout, getShow } from '@/infra/db/repositories/showsRepo';
import { listTakes } from '@/infra/db/repositories/takesRepo';
import { joinRoot } from '@/infra/files/layout';

import type { ServiceLabels } from '../app/labels';
import { soundSettingsFromShow } from '../audio/renderDocumentFromDb';

export interface EpisodeDeps {
  db: SqlExecutor;
  newId: () => string;
  now: () => number;
  /** 既定の概要欄など、DB に書き込む文言。UI 層が i18n から渡す（Issue #80）。 */
  labels: () => ServiceLabels;
  /** データルートの絶対パス。録音ファイルの削除に使う。 */
  root: string;
  /** 絶対パスのファイルを消す（無ければ何もしない）。 */
  deleteFile: (abs: string) => void;
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

  /** 新規エピソード。話数を採番し、Opening / Ending / BGM を配置し、概要欄テンプレートを適用する。 */
  async create(showId: string): Promise<EpisodeRow> {
    const { db, newId, now } = this.deps;
    const show = await getShow(db, showId);
    if (!show) throw new Error('show not found');
    const layout = await getLayout(db, showId);
    const template = await getDefaultTemplate(db, showId);
    const id = newId();
    const t = now();
    // 話数はカウンターではなく既存行から導出する（FR-EP-6 / REQUIREMENTS.md §2.1.1）。
    const episodeNumber = await nextEpisodeNumber(db, showId);
    // 既定タイトルは空。話数は UI が `#N` として別に出すので、タイトルに焼き込まない
    // （焼き込むと、あとから話数を直したときにタイトルだけ古い番号のまま残る）。
    const title = '';
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
        // BGM を下げる量は番組の既定を写す。写した後はエピソードの値（Issue #174）
        soundSettings: soundSettingsFromShow(layout.bgm_duck_db),
        now: t,
      });
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
          loop: true,
          endMode: 'timeline_end',
        });
      }
      const doc: EditableDoc = { voice: [], overlays };
      await saveDoc(db, id, doc, t);
      // 番組のトークテーマのひな形を写す（FR-SHOW-4）。写した後はエピソードのデータ。
      const template = await listShowTopicTemplate(db, showId);
      await saveOutline(
        db,
        id,
        template.map((tp) => newItem(newId(), tp.heading, tp.body)),
      );
    });
    return (await getEpisode(db, id))!;
  }

  async touch(id: string): Promise<void> {
    await updateEpisode(this.deps.db, id, { lastOpenedAt: this.deps.now() }, this.deps.now());
  }

  async update(id: string, patch: Parameters<typeof updateEpisode>[2]): Promise<void> {
    await updateEpisode(this.deps.db, id, patch, this.deps.now());
  }

  /**
   * 状態の自動判定（FR-EP-3）: exported は書き出し完了時に付く。声があれば ready、無ければ draft。
   * 音声を削除した回（FR-EP-4）は声が無いのが正常なので draft へ戻さない。
   */
  async refreshStatus(id: string): Promise<void> {
    const ep = await getEpisode(this.deps.db, id);
    if (!ep || ep.status === 'exported' || ep.audio_purged_at !== null) return;
    const doc = await loadDoc(this.deps.db, id);
    const status = doc.voice.length > 0 ? 'ready' : 'draft';
    if (status !== ep.status) await updateEpisode(this.deps.db, id, { status }, this.deps.now());
  }

  /**
   * エピソードを削除（FR-EP-4）。録音・ピーク・書き出しのファイルもすぐに消す（Issue #152、
   * ユーザー判断 2026-09-29）。アプリの内部にしかないファイルは、ユーザーが取り出せないので残さない。
   * 取り消しはできない（削除の前に確認する。FR-UI-2）。話数は次の新規作成で再利用される。
   *
   * 行は `deleted_at` を立てて残す（将来の同期で削除を伝えるため。DATA_MODEL.md §1）。
   * ファイルが消せなければ `file_delete_failed` を投げ、DB は変えない。
   */
  async remove(id: string): Promise<void> {
    const ep = await getEpisode(this.deps.db, id);
    if (!ep) throw new Error('episode not found');
    await this.purgeFiles(id, { exports: true, markDeleted: true });
  }

  /**
   * 音声を削除（FR-EP-4）。録音ファイルと takes を消し、行・話数・メタデータ・書き出し履歴は残す。
   * 容量を空ける目的の削除はこちら。話数は消費したままになる。
   * ファイルが消せなければ `file_delete_failed` を投げ、DB は変えない。
   */
  async purgeAudio(id: string): Promise<void> {
    const ep = await getEpisode(this.deps.db, id);
    if (!ep) throw new Error('episode not found');
    await this.purgeFiles(id, { exports: false, markDeleted: false });
  }

  /**
   * 削除済みなのにファイルが残っている回を片付ける。起動時に呼ぶ。
   * 削除でファイルをすぐ消すようになる前（Issue #152 より前）に消した回が対象。
   * 失敗した回は飛ばし、次の起動でまた試す。
   *
   * @returns 片付けた回の数
   */
  async cleanupDeleted(): Promise<number> {
    const rows = await this.deps.db.all<{ id: string }>(
      `SELECT e.id FROM episodes e
        WHERE e.deleted_at IS NOT NULL
          AND (e.audio_purged_at IS NULL
               OR EXISTS (SELECT 1 FROM exports x WHERE x.episode_id = e.id))`,
    );
    let n = 0;
    for (const r of rows) {
      try {
        await this.purgeFiles(r.id, { exports: true, markDeleted: false });
        n++;
      } catch {
        /* 次の起動で再試行する */
      }
    }
    return n;
  }

  /**
   * 録音（と、指定すれば書き出し）のファイルを消し、DB をそれに合わせる。
   *
   * 順序は **ファイルを先に消し、全部消せたら DB を確定する**（ユーザー判断 2026-09-29）。
   * DB だけ消えてファイルが残ると、どこからも参照されない容量が残り、ユーザーには消す手段が無い。
   * 途中で失敗したら `file_delete_failed` を投げ、DB は変えない。消すのは「無ければ何もしない」
   * なので、もう一度実行すれば残りを消して DB まで進む。
   */
  private async purgeFiles(
    id: string,
    opts: { exports: boolean; markDeleted: boolean },
  ): Promise<void> {
    const { db, root, deleteFile, now } = this.deps;
    // 個別に削除したテイク（論理削除）のファイルも含めて消す。
    const files = await db.all<{ path: string; peaks_path: string | null }>(
      `SELECT s.path, s.peaks_path FROM take_segments s
         JOIN takes t ON t.id = s.take_id
        WHERE t.episode_id = ?`,
      [id],
    );
    const exportFiles = opts.exports
      ? await db.all<{ path: string | null }>('SELECT path FROM exports WHERE episode_id = ?', [id])
      : [];
    const rels = [
      ...files.flatMap((f) => (f.peaks_path ? [f.path, f.peaks_path] : [f.path])),
      ...exportFiles.flatMap((x) => (x.path ? [x.path] : [])),
    ];
    try {
      for (const rel of rels) deleteFile(joinRoot(root, rel));
    } catch (e) {
      throw new AppError('file_delete_failed', {}, e);
    }
    const t = now();
    await db.transaction(async () => {
      const doc = await loadDoc(db, id);
      // 声と、Take に紐づくオーバーレイは参照先が消えるので落とす。
      // タイムライン上に固定されたオーバーレイ（Opening / Ending / BGM）は残す。
      await saveDoc(
        db,
        id,
        { voice: [], overlays: doc.overlays.filter((o) => o.anchor.type !== 'source') },
        t,
      );
      // 録音中の出来事とチャプターも、指していた録音ごと消える。
      await db.run('DELETE FROM recording_events WHERE episode_id = ?', [id]);
      await db.run(
        'UPDATE outline_items SET recorded_take_id = NULL, recorded_src_smp = NULL WHERE episode_id = ?',
        [id],
      );
      // 編集履歴は消えた声を指すので、Undo で復元できないようにここで捨てる。
      await db.run('DELETE FROM edit_ops WHERE episode_id = ?', [id]);
      await db.run('UPDATE episodes SET undo_cursor = 0 WHERE id = ?', [id]);
      if (opts.exports) await db.run('DELETE FROM exports WHERE episode_id = ?', [id]);
      await markAudioPurged(db, id, t);
      if (opts.markDeleted) await softDeleteEpisode(db, id, t);
    });
  }

  /**
   * 複製して新しい回にする: メタデータ・音の仕上げ・書き出しプリセットの選択・オーバーレイ・
   * トークテーマを引き継ぎ、録音は引き継がない（書き出しプリセットは DATA_MODEL.md §4.5.1）。
   */
  async duplicate(id: string): Promise<EpisodeRow> {
    const src = await getEpisode(this.deps.db, id);
    if (!src) throw new Error('episode not found');
    const created = await this.create(src.show_id);
    const doc = await loadDoc(this.deps.db, id);
    await this.deps.db.transaction(async () => {
      await updateEpisode(
        this.deps.db,
        created.id,
        {
          description: src.description,
          season: src.season,
          soundSettings: src.sound_settings,
          exportPreset: src.export_preset,
        },
        this.deps.now(),
      );
      await saveDoc(
        this.deps.db,
        created.id,
        {
          voice: [],
          overlays: doc.overlays
            .filter((o) => o.anchor.type !== 'source')
            .map((o) => ({ ...o, id: this.deps.newId() })),
        },
        this.deps.now(),
      );
      // トークテーマと台本は引き継ぐが、チャプター（録音位置）は引き継がない。
      const outline = await listOutline(this.deps.db, id);
      await saveOutline(
        this.deps.db,
        created.id,
        outline.map((i) => newItem(this.deps.newId(), i.heading, i.body)),
      );
    });
    return (await getEpisode(this.deps.db, created.id))!;
  }

  listTakes(episodeId: string) {
    return listTakes(this.deps.db, episodeId);
  }
}
