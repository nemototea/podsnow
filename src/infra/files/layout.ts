/**
 * DATA_MODEL.md §2 のファイルレイアウト。DB には root からの相対パスを保存し、
 * ネイティブには絶対パスを渡す。root は起動時に expo-file-system の Paths.document から決める。
 */
export const ROOT_DIR_NAME = 'podsnow';

export const relPaths = {
  db: () => 'db/podsnow.db',
  showDir: (showId: string) => `shows/${showId}`,
  assetFile: (showId: string, assetId: string) => `shows/${showId}/assets/${assetId}.wav`,
  assetPeaks: (showId: string, assetId: string) => `shows/${showId}/assets/${assetId}.peaks`,
  episodeDir: (episodeId: string) => `episodes/${episodeId}`,
  takeDir: (episodeId: string, takeId: string) => `episodes/${episodeId}/takes/${takeId}`,
  segmentFile: (episodeId: string, takeId: string, seq: number) =>
    `episodes/${episodeId}/takes/${takeId}/seg-${String(seq).padStart(4, '0')}.wav`,
  segmentPeaks: (episodeId: string, takeId: string, seq: number) =>
    `episodes/${episodeId}/takes/${takeId}/seg-${String(seq).padStart(4, '0')}.peaks`,
  exportFile: (episodeId: string, exportId: string, ext: string) =>
    `episodes/${episodeId}/exports/${exportId}.${ext}`,
  tmp: () => 'tmp',
};

export function joinRoot(root: string, rel: string): string {
  return root.endsWith('/') ? `${root}${rel}` : `${root}/${rel}`;
}
