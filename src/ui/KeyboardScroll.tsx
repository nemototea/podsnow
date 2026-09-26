import type { ComponentProps } from 'react';
import { ScrollView } from 'react-native-gesture-handler';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Reanimated from 'react-native-reanimated';

import { space } from './tokens';

/**
 * Reanimated で動かせる Gesture Handler の ScrollView（`KeyboardAwareScrollView` の中身）。
 * 型は forwardRef の印（`$$typeof`）が無いだけで、実体は同じ ScrollView なので寄せる。
 */
const GestureScrollView = Reanimated.createAnimatedComponent(ScrollView) as unknown as NonNullable<
  ComponentProps<typeof KeyboardAwareScrollView>['ScrollViewComponent']
>;

/** キーボードと入力中の欄（複数行ならカーソル）とのあいだに空ける距離。 */
const KEYBOARD_GAP = space.lg;

/**
 * キーボードが出たら、入力中の欄（複数行ならカーソル位置）が見えるまでずらす ScrollView（Issue #132）。
 * `Screen` と iOS の `Sheet` が使う。画面ごとに個別の対応はしない。
 *
 * 中身は Gesture Handler の ScrollView にして、中のドラッグ（並べ替えのつまみ・波形のハンドル）が
 * 先に始まったらスクロールを止められるようにする。
 * 出典: node_modules/react-native-keyboard-controller（1.21.9）の `KeyboardAwareScrollView` の型定義
 */
export function KeyboardScroll(props: ComponentProps<typeof KeyboardAwareScrollView>) {
  return (
    <KeyboardAwareScrollView
      ScrollViewComponent={GestureScrollView}
      bottomOffset={KEYBOARD_GAP}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      {...props}
    />
  );
}
