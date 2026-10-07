import type { IconName } from './IconSvg';

/**
 * 専門用語の説明（DESIGN_SYSTEM.md §2.2、Issue #170）。ラベルの横の ⓘ から開く。
 * 文言は `src/i18n` の `glossary` に置く。
 */
export interface TermInfo {
  /** 用語。説明の題になる。 */
  term: string;
  /** 何が起きるかを 1〜2 文で。仕組みの詳細は書かない。 */
  body: string;
}

/** 「…」メニューの 1 項目。iOS はネイティブのメニュー、ほかはシートの行になる。 */
export interface MenuAction {
  key: string;
  label: string;
  /** シートの行と iOS のヘッダーメニューで補足として出す。 */
  sub?: string;
  icon?: IconName;
  destructive?: boolean;
  onPress: () => void;
}

/** 選択肢の 1 項目。 */
export interface ChoiceOption<T extends string | number> {
  value: T;
  label: string;
  sub?: string;
}

/** ヘッダーの「…」の手前に並べるボタン（取り消し / やり直しなど）。 */
export interface HeaderButton {
  key: string;
  icon: IconName;
  /** 読み上げのラベル。 */
  label: string;
  disabled?: boolean;
  onPress: () => void;
}

export interface MoreMenuProps {
  /** 読み上げのラベル（例: 「エピソード 3 の操作」）。 */
  label: string;
  /** シートの題（iOS はメニューの見出し）。 */
  title?: string;
  actions: readonly MenuAction[];
  disabled?: boolean;
  /** 「…」の色。既定は弱い文字の色（見本 `.ib`）。番組の色の上では白。 */
  color?: string;
}

export interface HeaderMenuProps extends MoreMenuProps {
  /** 「…」の手前に並べるボタン。`disabled` は「…」の `disabled` と独立。 */
  buttons?: readonly HeaderButton[];
}

export interface ChoiceMenuProps<T extends string | number> {
  /** 行のラベル。 */
  label: string;
  /** 行の補足（選択中の値の説明）。 */
  sub?: string;
  /** シートの題。 */
  title: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (v: T) => void;
  /** 選択肢が無いときの説明。 */
  emptyText?: string;
  /** カードの最後の行（下の区切り線を出さない）。 */
  last?: boolean;
  /** ラベルが専門用語のとき、横に ⓘ を出して説明する（Issue #170）。 */
  info?: TermInfo;
}
