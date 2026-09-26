export interface NormalizedImage {
  /** 処理後の一時ファイル URI。呼び出し側が永続領域へ移す。 */
  uri: string;
  width: number;
  height: number;
}

/** 画像のデコード・切り抜き・縮小だけを infra に閉じ込める。 */
export interface ImageProcessorPort {
  normalizeSquareJpeg(
    source: { uri: string; width: number; height: number },
    maxPixels: number,
  ): Promise<NormalizedImage>;
}
