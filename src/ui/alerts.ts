import { ActionSheetIOS, Platform } from 'react-native';

import { dialogs } from './dialogStore';

/**
 * 取り消せない操作・注意の要る操作の確認（DESIGN_SYSTEM.md §6.3）。自作のダイアログで出す。
 */
export function confirmDestructive(o: {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
}): void {
  dialogs.show({ ...o, tone: 'danger' });
}

/** 知らせるだけのダイアログ（エラーなど）。 */
export function notify(o: { title: string; message?: string; okLabel: string }): void {
  dialogs.show({
    title: o.title,
    ...(o.message ? { message: o.message } : {}),
    confirmLabel: o.okLabel,
    tone: 'primary',
  });
}

/** 2 択の問いかけ（マイクの許可の前置きなど）。 */
export function ask(o: {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel?: () => void;
}): void {
  dialogs.show({ ...o, tone: 'primary' });
}

/**
 * iOS のアクションシートで 1 つ選ばせる。iOS 以外では何もせず false を返す（呼び出し側がシートで代える）。
 */
export function iosActionSheet(o: {
  title: string;
  message?: string;
  cancelLabel: string;
  options: readonly { label: string; destructive?: boolean; onPress: () => void }[];
}): boolean {
  if (Platform.OS !== 'ios') return false;
  const destructive = o.options.findIndex((x) => x.destructive);
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: o.title,
      ...(o.message ? { message: o.message } : {}),
      options: [...o.options.map((x) => x.label), o.cancelLabel],
      cancelButtonIndex: o.options.length,
      ...(destructive >= 0 ? { destructiveButtonIndex: destructive } : {}),
    },
    (i) => o.options[i]?.onPress(),
  );
  return true;
}
