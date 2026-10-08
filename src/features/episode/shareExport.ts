import * as Sharing from 'expo-sharing';

import type { ExportService } from '@/services/export/ExportService';

export type ShareExportResult = 'shared' | 'missing' | 'unavailable';

/**
 * 書き出したファイルを、番組名・話数・タイトルの名前を付けて共有シートに渡す（Issue #166）。
 * ファイルが無ければ 'missing'、共有できない端末なら 'unavailable'。コピーの失敗は例外（`share_prepare_failed`）。
 */
export async function shareExport(
  exporter: ExportService,
  exportId: string,
): Promise<ShareExportResult> {
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  const file = await exporter.prepareShare(exportId);
  if (!file) return 'missing';
  await Sharing.shareAsync(file.uri, {
    mimeType: file.format === 'wav' ? 'audio/wav' : 'audio/mp4',
    UTI: file.format === 'wav' ? 'com.microsoft.waveform-audio' : 'public.mpeg-4-audio',
    // Android の共有シートの見出し（ファイル名にはならない。名前はコピーで付けている）
    dialogTitle: file.fileName,
  });
  return 'shared';
}
