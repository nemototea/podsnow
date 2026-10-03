import { AppError } from '@/domain/errors';
import type { EditableDoc } from '@/domain/editing/doc';
import { renderTemplate } from '@/domain/metadata/template';
import { renderFingerprint } from '@/domain/render/fingerprint';
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
import {
  getDefaultTemplate,
  getLayout,
  getShow,
  type ShowRow,
} from '@/infra/db/repositories/showsRepo';
import { listTakes } from '@/infra/db/repositories/takesRepo';
import { joinRoot } from '@/infra/files/layout';

import type { ServiceLabels } from '../app/labels';
import { parseSoundSettings } from '../audio/renderDocumentFromDb';

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
    const id = newId();
    const t = now();
    // 話数はカウンターではなく既存行から導出する（FR-EP-6 / REQUIREMENTS.md §2.1.1）。
    const episodeNumber = await nextEpisodeNumber(db, showId);
    // 既定タイトルは空。話数は UI が `#N` として別に出すので、タイトルに焼き込まない
    // （焼き込むと、あとから話数を直したときにタイトルだけ古い番号のまま残る）。
    const title = '';
    const description = await this.defaultDescription(show, episodeNumber);
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
      const doc: EditableDoc = { voice: [], overlays: await this.defaultOverlays(showId) };
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

  /** 新しい回の概要欄（番組の概要欄テンプレートを展開したもの。テンプレートが無ければ空）。 */
  private async defaultDescription(show: ShowRow, episodeNumber: number): Promise<string> {
    const template = await getDefaultTemplate(this.deps.db, show.id);
    return template
      ? renderTemplate(template.body, {
          title: '',
          episodeNumber,
          season: show.default_season,
          topics: [],
          showName: show.name,
        })
      : '';
  }

  /** 新しい回の素材の配置（番組の既定構成。FR-EP-2）。 */
  private async defaultOverlays(showId: string): Promise<OverlayClip[]> {
    const { db, newId } = this.deps;
    const layout = await getLayout(db, showId);
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
    return overlays;
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
   * 開いて何も入れずに離れた回を捨てる（REQUIREMENTS.md FR-EP-10、Issue #168）。
   * 捨て方は「エピソードを削除」と同じ（`deleted_at`）。話数は次の新規作成に戻る（§2.1.1）。
   *
   * @returns 捨てたら true。何か入っている・もう無い回は何もしない
   */
  async discardIfEmpty(id: string): Promise<boolean> {
    if (!(await this.isUntouched(id))) return false;
    await this.purgeFiles(id, { exports: true, markDeleted: true });
    return true;
  }

  /**
   * 起動時: 一度でも開いて、何も入れないまま残った回を捨てる（強制終了などで、離れたときの
   * 片付けが走らなかった回）。複製しただけでまだ開いていない回（`last_opened_at = created_at`）は
   * 対象にしない。失敗した回は飛ばす（次の起動でまた試す）。
   *
   * @returns 捨てた回の数
   */
  async discardEmptyOpened(showId: string): Promise<number> {
    const rows = await this.deps.db.all<{ id: string }>(
      `SELECT e.id FROM episodes e
        WHERE e.show_id = ? AND e.deleted_at IS NULL AND e.last_opened_at > e.created_at
          AND NOT EXISTS (SELECT 1 FROM takes t WHERE t.episode_id = e.id)
          AND NOT EXISTS (SELECT 1 FROM exports x WHERE x.episode_id = e.id)
        ORDER BY e.episode_number DESC, e.created_at DESC`,
      [showId],
    );
    let n = 0;
    for (const r of rows) {
      try {
        if (await this.discardIfEmpty(r.id)) n++;
      } catch {
        /* 次の起動で再試行する */
      }
    }
    return n;
  }

  /**
   * 何も入れていない回か（FR-EP-10）。**いま新しく作ったときと同じ**中身で、録音・書き出し・
   * 配信済みの回とのつながりが無いこと。どれか 1 つでも違えば false（消しすぎる側に倒れない）。
   */
  private async isUntouched(id: string): Promise<boolean> {
    const { db } = this.deps;
    const ep = await getEpisode(db, id);
    if (!ep || ep.deleted_at !== null || ep.audio_purged_at !== null) return false;
    const show = await getShow(db, ep.show_id);
    if (!show) return false;
    // 録音中・ゴミ箱・失敗を含め、録音の行が 1 つでもあれば残す
    const traces = await db.get<{ n: number }>(
      `SELECT
         (SELECT COUNT(*) FROM takes WHERE episode_id = ?) +
         (SELECT COUNT(*) FROM exports WHERE episode_id = ?) +
         (SELECT COUNT(*) FROM feed_episodes
           WHERE episode_id = ? OR (show_id = ? AND guid = ?)) AS n`,
      [id, id, id, ep.show_id, ep.guid],
    );
    if ((traces?.n ?? 0) > 0) return false;
    const metadataUntouched =
      ep.title === '' &&
      ep.description_suggestion === null &&
      ep.season === show.default_season &&
      ep.recorded_at === ep.created_at &&
      ep.publish_planned_at === null &&
      ep.published_at === null &&
      ep.episode_type === 'full' &&
      ep.explicit === null &&
      ep.website_url === '';
    if (!metadataUntouched) return false;
    // 話数と概要は、今の採番の式とテンプレートで作り直した値と比べる（#211 で式が変わっても追従する）
    if (ep.episode_number !== (await nextEpisodeNumber(db, ep.show_id, id))) return false;
    if (ep.description !== (await this.defaultDescription(show, ep.episode_number))) return false;
    // 声・素材・音の仕上げは、書き出しの判定と同じ指紋で比べる（行の id は見ない）
    const doc = await loadDoc(db, id);
    const blank = renderFingerprint({
      voice: [],
      overlays: await this.defaultOverlays(ep.show_id),
      sound: parseSoundSettings(null),
    });
    const current = renderFingerprint({
      voice: doc.voice,
      overlays: doc.overlays,
      sound: parseSoundSettings(ep.sound_settings),
    });
    if (current !== blank) return false;
    const [outline, template] = await Promise.all([
      listOutline(db, id),
      listShowTopicTemplate(db, ep.show_id),
    ]);
    return (
      outline.length === template.length &&
      outline.every(
        (item, i) =>
          item.heading === template[i]!.heading &&
          item.body === template[i]!.body &&
          item.doneAt === null &&
          item.recordedTakeId === null,
      )
    );
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
