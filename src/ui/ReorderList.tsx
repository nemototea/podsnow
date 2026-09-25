import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useT } from '@/i18n';

import { Icon } from './Icon';
import { dropIndex, shiftFor, slotOffset } from './reorder';
import { useAppTheme } from './ThemeContext';
import { hit, motion } from './tokens';
import { useReducedMotion } from './useReducedMotion';

/** `renderItem` に渡す、行へ組み込む部品。 */
export interface ReorderRowParts {
  /** 行の右端に置くつまみ。 */
  grip: ReactNode;
  /** 行の読み上げ要素に付ける操作（上へ移動 / 下へ移動）。 */
  a11y: {
    accessibilityActions: AccessibilityActionInfo[];
    onAccessibilityAction: (e: AccessibilityActionEvent) => void;
  };
}

export interface ReorderListProps<T> {
  items: readonly T[];
  keyOf: (item: T) => string;
  /** 移動したあとに読み上げる名前。 */
  labelOf: (item: T) => string;
  /** 並べ替えを保存する。失敗したら reject する（行を元の位置へ戻す）。 */
  onMove: (from: number, to: number) => Promise<void>;
  renderItem: (item: T, index: number, parts: ReorderRowParts) => ReactNode;
  /** 並べ替えを止める（録音中など）。つまみは淡く、読み上げの操作も出さない。 */
  disabled?: boolean;
  /** 掴んだとき・行を越えたときの触覚。`ui/` は services を持たないので呼び出し側が渡す。 */
  onPick?: () => void;
  onCross?: () => void;
}

/** ドラッグ中の状態。UI スレッドで読むので shared value にまとめる。 */
interface DragState {
  /** 掴んでいる行。掴んでいなければ -1。 */
  active: SharedValue<number>;
  /** いま離したら入る位置。 */
  target: SharedValue<number>;
  /** 掴んだ行の縦の移動量。 */
  dy: SharedValue<number>;
  /** 各行の実測の高さ（並びの順）。 */
  heights: SharedValue<number[]>;
}

interface Handlers {
  measure: (key: string, h: number) => void;
  pick: () => void;
  cross: () => void;
  drop: (from: number, to: number) => void;
  /** 読み上げの操作から 1 つ動かす。 */
  moveBy: (from: number, to: number) => void;
}

const EASE = { duration: motion.quick, easing: Easing.out(Easing.cubic) };

/**
 * つまみのドラッグで並べ替える列（アプリの並べ替えはすべてこれ。Issue #119 / #121）。
 *
 * - ドラッグはつまみにだけ付ける。行の押下（詳細を開くなど）やスクロールと衝突させない
 * - 読み上げ中はドラッグできないので、行に「上へ移動」「下へ移動」の操作を付ける（見た目には出さない）
 * - 離した行は新しい並びが描かれるまで離した位置に留める。先に戻すと、保存を待つ間に元の位置へ一瞬跳ねる
 * - 録音中は親がメーターの頻度で描き直される。行へ渡す関数は固定し、ジェスチャーを作り直さない
 *
 * スクロールの中に置くときは、Gesture Handler の ScrollView の中に置く（`Screen` と `Sheet` はそうしてある）。
 */
export function ReorderList<T>({
  items,
  keyOf,
  labelOf,
  onMove,
  renderItem,
  disabled = false,
  onPick,
  onCross,
}: ReorderListProps<T>) {
  const t = useT();
  const active = useSharedValue(-1);
  const target = useSharedValue(-1);
  const dy = useSharedValue(0);
  const heights = useSharedValue<number[]>([]);
  const drag = useMemo<DragState>(
    () => ({ active, target, dy, heights }),
    [active, target, dy, heights],
  );
  const sizes = useRef(new Map<string, number>());

  // 最新の値は ref から読む。行へ渡す関数を固定するため。
  const latest = useRef({ items, keyOf, labelOf, onMove, onPick, onCross, t });
  useLayoutEffect(() => {
    latest.current = { items, keyOf, labelOf, onMove, onPick, onCross, t };
  });

  const keys = items.map(keyOf);
  const order = keys.join('\n');
  useLayoutEffect(() => {
    // 新しい並びが描かれたら、ずらしていた分を一斉に戻す。
    heights.set(order.split('\n').map((k) => sizes.current.get(k) ?? 0));
    active.set(-1);
    target.set(-1);
    dy.set(0);
  }, [order, heights, active, target, dy]);

  const measure = useCallback(
    (key: string, h: number) => {
      sizes.current.set(key, h);
      const { items: now, keyOf: k } = latest.current;
      heights.set(now.map((i) => sizes.current.get(k(i)) ?? 0));
    },
    [heights],
  );

  const move = useCallback(
    (from: number, to: number) =>
      latest.current.onMove(from, to).catch((e: unknown) => {
        active.set(-1);
        target.set(-1);
        dy.set(0);
        throw e;
      }),
    [active, target, dy],
  );

  const handlers = useMemo<Handlers>(
    () => ({
      measure,
      pick: () => latest.current.onPick?.(),
      cross: () => latest.current.onCross?.(),
      drop: (from, to) => void move(from, to),
      moveBy: (from, to) => {
        const { items: now, labelOf: label, t: tt } = latest.current;
        const item = now[from];
        if (item === undefined || to < 0 || to >= now.length) return;
        void move(from, to).then(() =>
          AccessibilityInfo.announceForAccessibility(
            tt.a11y.movedTo(label(item), to + 1, now.length),
          ),
        );
      },
    }),
    [measure, move],
  );

  return (
    <View>
      {items.map((item, i) => (
        <ReorderRow
          key={keys[i]}
          itemKey={keys[i]!}
          index={i}
          count={items.length}
          disabled={disabled}
          drag={drag}
          on={handlers}
          render={(parts) => renderItem(item, i, parts)}
        />
      ))}
    </View>
  );
}

function ReorderRow({
  itemKey,
  index,
  count,
  disabled,
  drag,
  on,
  render,
}: {
  itemKey: string;
  index: number;
  count: number;
  disabled: boolean;
  drag: DragState;
  on: Handlers;
  render: (parts: ReorderRowParts) => ReactNode;
}) {
  const c = useAppTheme();
  const t = useT();
  const reduced = useReducedMotion();
  const { active, target, dy, heights } = drag;
  const offset = useSharedValue(0);

  // 掴んだ行が通り過ぎたら、この行が避ける。掴み終えたら（並びが描き直されたら）即座に 0 へ。
  useAnimatedReaction(
    () => {
      const a = active.get();
      return a < 0 ? null : shiftFor(index, a, target.get(), heights.get()[a] ?? 0);
    },
    (shift) => {
      if (shift === null) offset.set(0);
      else offset.set(reduced ? shift : withTiming(shift, EASE));
    },
    [index, reduced],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled)
        // つまみに触れて動かした時点で掴む。先にスクロールが始まらないように。
        .minDistance(0)
        .onStart(() => {
          active.set(index);
          target.set(index);
          dy.set(0);
          runOnJS(on.pick)();
        })
        .onUpdate((e) => {
          dy.set(e.translationY);
          const to = dropIndex(heights.get(), index, e.translationY);
          if (to !== target.get()) {
            target.set(to);
            runOnJS(on.cross)();
          }
        })
        .onFinalize(() => {
          if (active.get() !== index) return;
          const to = target.get();
          const settle = slotOffset(heights.get(), index, to);
          const done = (finished?: boolean) => {
            'worklet';
            if (finished === false) return;
            if (to === index) active.set(-1);
            else runOnJS(on.drop)(index, to);
          };
          if (reduced) {
            dy.set(settle);
            done(true);
          } else dy.set(withTiming(settle, EASE, done));
        }),
    [index, disabled, reduced, active, target, dy, heights, on],
  );

  const accessibilityActions = useMemo(
    () =>
      disabled
        ? []
        : [
            ...(index > 0 ? [{ name: 'moveUp', label: t.common.moveUp }] : []),
            ...(index < count - 1 ? [{ name: 'moveDown', label: t.common.moveDown }] : []),
          ],
    [index, count, disabled, t],
  );
  const onAccessibilityAction = useCallback(
    (e: AccessibilityActionEvent) => {
      if (e.nativeEvent.actionName === 'moveUp') on.moveBy(index, index - 1);
      else if (e.nativeEvent.actionName === 'moveDown') on.moveBy(index, index + 1);
    },
    [index, on],
  );

  const style = useAnimatedStyle(() => {
    const lifted = active.get() === index;
    return {
      zIndex: lifted ? 1 : 0,
      backgroundColor: lifted ? c.surfaceHover : 'transparent',
      transform: [{ translateY: lifted ? dy.get() : offset.get() }],
    };
  });

  const grip = (
    <GestureDetector gesture={pan}>
      {/* 読み上げではドラッグできないので隠す。代わりに行の操作で動かす。 */}
      <View
        style={st.grip}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon name="grip" color={disabled ? c.textDisabled : c.textSecondary} />
      </View>
    </GestureDetector>
  );

  return (
    <Reanimated.View
      style={style}
      onLayout={(e) => on.measure(itemKey, e.nativeEvent.layout.height)}
    >
      {render({ grip, a11y: { accessibilityActions, onAccessibilityAction } })}
    </Reanimated.View>
  );
}

const st = StyleSheet.create({
  grip: { width: hit.min, height: hit.min, alignItems: 'center', justifyContent: 'center' },
});
