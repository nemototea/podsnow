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
  /**
   * 画像を `size`×`size` に縮め、RGBA の画素を返す（アートワークの代表色のため。DESIGN_SYSTEM.md §2.6）。
   * `uri` は縮めた画像の一時ファイル。呼び出し側が消す。
   */
  samplePixels(source: string, size: number): Promise<{ rgba: Uint8Array; uri: string }>;
}
