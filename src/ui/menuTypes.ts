import type { IconName } from './IconSvg';

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
}
