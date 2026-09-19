import { smp, type Smp } from '@/domain/time';
import { appendTake } from '@/domain/timeline/voice';
import type { SqlExecutor } from '@/infra/db/executor';
import { loadDoc, saveDoc } from '@/infra/db/repositories/editableDocRepo';
import {
  closeJournal,
  closeSegment,
  finalizeTake,
  getSegment,
  getTake,
  listOpenJournals,
  listSegments,
} from '@/infra/db/repositories/takesRepo';
import { joinRoot } from '@/infra/files/layout';

import type { RecorderPort } from './RecorderPort';

export interface RecoveredTake {
  takeId: string;
  episodeId: string;
  durationSmp: Smp;
  /** 修復した Segment 数。 */
  segments: number;
}

export interface RecoveryDeps {
  db: SqlExecutor;
  recorder: Pick<RecorderPort, 'repairWavHeader'>;
  root: string;
  fileExists: (absPath: string) => boolean;
  newId: () => string;
  now: () => number;
}

/**
 * 起動時の復旧（DATA_MODEL.md §6）。
 * recovery_journal が open のままの Segment を、ファイル実長からヘッダ修復して確定し、
 * Take を recovered にして声トラック末尾に追加する。
 */
export async function recoverUnfinishedTakes(deps: RecoveryDeps): Promise<RecoveredTake[]> {
  const journals = await listOpenJournals(deps.db);
  const byTake = new Map<string, typeof journals>();
  for (const j of journals) {
    const arr = byTake.get(j.take_id) ?? [];
    arr.push(j);
    byTake.set(j.take_id, arr);
  }
  const out: RecoveredTake[] = [];
  for (const [takeId, js] of byTake) {
    const take = await getTake(deps.db, takeId);
    if (!take) {
      for (const j of js) await closeJournal(deps.db, j.segment_id);
      continue;
    }
    let repaired = 0;
    for (const j of js) {
      const seg = await getSegment(deps.db, j.segment_id);
      if (!seg) {
        await closeJournal(deps.db, j.segment_id);
        continue;
      }
      const abs = joinRoot(deps.root, seg.path);
      let frames = 0;
      if (deps.fileExists(abs)) {
        try {
          frames = (await deps.recorder.repairWavHeader(abs)).frames;
          repaired++;
        } catch {
          frames = 0;
        }
      }
      await deps.db.transaction(async () => {
        await closeSegment(deps.db, seg.id, frames, 'crash_recovered');
        await closeJournal(deps.db, seg.id);
      });
    }
    // Take の総尺は全 Segment の合計。offset も再計算する。
    const segs = await listSegments(deps.db, takeId);
    let total = 0;
    for (const s of segs) {
      await deps.db.run('UPDATE take_segments SET offset_smp = ? WHERE id = ?', [total, s.id]);
      total += s.duration_smp ?? 0;
    }
    const durationSmp = smp(total);
    const now = deps.now();
    // 既に声トラックに入っていれば追加しない（stop 直後にジャーナルだけ残ったケース）
    const doc = await loadDoc(deps.db, take.episode_id);
    const already = doc.voice.some((v) => v.takeId === takeId);
    await deps.db.transaction(async () => {
      await finalizeTake(
        deps.db,
        takeId,
        durationSmp > 0 ? 'recovered' : 'failed',
        durationSmp,
        now,
      );
      if (durationSmp > 0 && !already) {
        const voice = appendTake(doc.voice, { id: deps.newId(), takeId, durationSmp });
        await saveDoc(deps.db, take.episode_id, { ...doc, voice }, now);
      }
    });
    if (durationSmp > 0) {
      out.push({ takeId, episodeId: take.episode_id, durationSmp, segments: repaired });
    }
  }
  return out;
}
