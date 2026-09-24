/** 触覚の種類（DESIGN_SYSTEM.md §6.2）。OS の API の違いは infra 側で吸収する。 */
export type HapticKind =
  /** 録音の開始・停止など、重みのある操作。 */
  | 'impact'
  /** 一時停止・再開など、軽い操作。 */
  | 'light'
  /** タブ・選択範囲・トピックの切り替え。 */
  | 'selection'
  /** 書き出し完了・コピー完了。 */
  | 'success'
  /** 取り消せる削除・言い直し。 */
  | 'warning';

export interface HapticsPort {
  play: (kind: HapticKind) => Promise<void>;
}
