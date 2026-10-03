import { renderFingerprint } from '@/domain/render/fingerprint';
import type { SqlExecutor } from '@/infra/db/executor';
import { loadDoc } from '@/infra/db/repositories/editableDocRepo';

import { parseSoundSettings } from '../audio/renderDocumentFromDb';

/**
 * 今の編集の音の指紋（DATA_MODEL.md §4.13 `source_fingerprint`、Issue #168）。
 * 書き出しの行の値と同じなら、その書き出しは今の編集と同じ音。
 */
export async function currentSourceFingerprint(
  db: SqlExecutor,
  episodeId: string,
): Promise<string> {
  const doc = await loadDoc(db, episodeId);
  const ep = await db.get<{ sound_settings: string }>(
    'SELECT sound_settings FROM episodes WHERE id = ?',
    [episodeId],
  );
  return renderFingerprint({
    voice: doc.voice,
    overlays: doc.overlays,
    sound: parseSoundSettings(ep?.sound_settings),
  });
}
