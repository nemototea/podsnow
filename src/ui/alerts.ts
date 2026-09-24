import { ActionSheetIOS, Alert, Platform } from 'react-native';

/**
 * 取り消せない操作・注意の要る操作の確認（DESIGN_SYSTEM.md §6.2）。OS のアラートを使う。
 * Web 検証では react-native-web の Alert が何もしないので、ブラウザの confirm で代える。
 */
export function confirmDestructive(o: {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
}): void {
  if (Platform.OS === 'web') {
    const ok = (globalThis as { confirm?: (m: string) => boolean }).confirm?.(
      o.message ? `${o.title}\n\n${o.message}` : o.title,
    );
    if (ok) o.onConfirm();
    return;
  }
  Alert.alert(o.title, o.message, [
    { text: o.cancelLabel, style: 'cancel' },
    { text: o.confirmLabel, style: 'destructive', onPress: o.onConfirm },
  ]);
}

/** 知らせるだけのアラート（エラーなど）。 */
export function notify(o: { title: string; message?: string; okLabel: string }): void {
  if (Platform.OS === 'web') {
    (globalThis as { alert?: (m: string) => void }).alert?.(
      o.message ? `${o.title}\n\n${o.message}` : o.title,
    );
    return;
  }
  Alert.alert(o.title, o.message, [{ text: o.okLabel }]);
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
  if (Platform.OS === 'web') {
    const ok = (globalThis as { confirm?: (m: string) => boolean }).confirm?.(
      o.message ? `${o.title}\n\n${o.message}` : o.title,
    );
    if (ok) o.onConfirm();
    else o.onCancel?.();
    return;
  }
  Alert.alert(o.title, o.message, [
    { text: o.cancelLabel, style: 'cancel', ...(o.onCancel ? { onPress: o.onCancel } : {}) },
    { text: o.confirmLabel, style: 'default', onPress: o.onConfirm },
  ]);
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

/** iOS の入力付きアラートで 1 行を入力させる。iOS 以外では何もせず false を返す（呼び出し側がシートで代える）。 */
export function iosPrompt(o: {
  title: string;
  defaultValue: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: (text: string) => void;
}): boolean {
  if (Platform.OS !== 'ios') return false;
  Alert.prompt(
    o.title,
    undefined,
    [
      { text: o.cancelLabel, style: 'cancel' },
      {
        text: o.confirmLabel,
        style: 'default',
        onPress: (text?: string) => o.onConfirm(text ?? ''),
      },
    ],
    'plain-text',
    o.defaultValue,
  );
  return true;
}
