export interface PickedImage {
  uri: string;
  width: number;
  height: number;
}

/** 端末の写真ライブラリから番組アートワーク候補を選ぶ境界。 */
export interface ImagePickerPort {
  pickSquare(): Promise<PickedImage | null>;
}
