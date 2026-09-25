import { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
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

import type { OutlineItem } from '@/domain/outline';
import { useT } from '@/i18n';
import { Icon, IconButton, Row } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { hit, motion, space } from '@/ui/tokens';
import { useReducedMotion } from '@/ui/useReducedMotion';

import { useServices } from '../app/ServicesProvider';
import { dropIndex, shiftFor, slotOffset } from './reorder';

export interface TopicListProps {
  items: readonly OutlineItem[];
  onOpen: (item: OutlineItem) => void;
  /** 並べ替えを保存する。保存に失敗したら reject する（行を元の位置へ戻す）。 */
  onMove: (from: number, to: number) => Promise<void>;
  onDelete: (item: OutlineItem) => void;
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

const EASE = { duration: motion.quick, easing: Easing.out(Easing.cubic) };

/**
 * トークテーマのシートの項目の列（FR-OUT-3）。右端のつまみをドラッグして並べ替える。
 *
 * - つまみにだけドラッグを付ける。行を押すと台本を開くので、行全体を掴ませると衝突する
 * - 読み上げ中はドラッグできないので、行に「上へ移動」「下へ移動」の操作を付ける（見た目には出さない）
 * - 離した行は新しい並びが描かれるまで離した位置に留める。先に戻すと、保存を待つ間に元の位置へ一瞬跳ねる
 */
export function TopicList({ items, onOpen, onMove, onDelete }: TopicListProps) {
  const t = useT();
  const { haptics } = useServices();
  const active = useSharedValue(-1);
  const target = useSharedValue(-1);
  const dy = useSharedValue(0);
  const heights = useSharedValue<number[]>([]);
  const drag = useMemo<DragState>(
    () => ({ active, target, dy, heights }),
    [active, target, dy, heights],
  );
  const sizes = useRef(new Map<string, number>());

  // 録音中はメーターの更新で親が頻繁に描き直される（FR-OUT-2 で録音中も並べ替える）。
  // 行へ渡す関数を固定して、行ごとの描き直しとジェスチャーの作り直しを避ける。最新の値は ref から読む。
  const latest = useRef({ items, onOpen, onMove, onDelete, t, haptics });
  useLayoutEffect(() => {
    latest.current = { items, onOpen, onMove, onDelete, t, haptics };
  });

  const order = items.map((i) => i.id).join('\n');
  useLayoutEffect(() => {
    // 新しい並びが描かれたら、ずらしていた分を一斉に戻す。
    heights.set(order.split('\n').map((id) => sizes.current.get(id) ?? 0));
    active.set(-1);
    target.set(-1);
    dy.set(0);
  }, [order, heights, active, target, dy]);

  const measure = useCallback(
    (id: string, h: number) => {
      sizes.current.set(id, h);
      heights.set(latest.current.items.map((i) => sizes.current.get(i.id) ?? 0));
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

  const handlers = useMemo<RowHandlers>(
    () => ({
      measure,
      open: (item) => latest.current.onOpen(item),
      remove: (item) => latest.current.onDelete(item),
      pick: () => latest.current.haptics.play('light'),
      cross: () => latest.current.haptics.play('selection'),
      drop: (from, to) => void move(from, to),
      moveBy: (from, to) => {
        const { items: now, t: tt } = latest.current;
        const item = now[from];
        if (!item || to < 0 || to >= now.length) return;
        void move(from, to).then(() =>
          AccessibilityInfo.announceForAccessibility(
            tt.record.a11yMovedTopic(item.heading, to + 1, now.length),
          ),
        );
      },
    }),
    [measure, move],
  );

  return (
    <View>
      {items.map((item, i) => (
        <TopicRow
          key={item.id}
          item={item}
          index={i}
          count={items.length}
          drag={drag}
          on={handlers}
        />
      ))}
    </View>
  );
}

interface RowHandlers {
  measure: (id: string, h: number) => void;
  open: (item: OutlineItem) => void;
  remove: (item: OutlineItem) => void;
  pick: () => void;
  cross: () => void;
  drop: (from: number, to: number) => void;
  /** 読み上げの操作から 1 つ動かす。 */
  moveBy: (from: number, to: number) => void;
}

const TopicRow = memo(function TopicRow({
  item,
  index,
  count,
  drag,
  on,
}: {
  item: OutlineItem;
  index: number;
  count: number;
  drag: DragState;
  on: RowHandlers;
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
    [index, reduced, active, target, dy, heights, on],
  );

  const actions = useMemo(
    () => [
      ...(index > 0 ? [{ name: 'moveUp', label: t.common.moveUp }] : []),
      ...(index < count - 1 ? [{ name: 'moveDown', label: t.common.moveDown }] : []),
    ],
    [index, count, t],
  );
  const onAction = useCallback(
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

  return (
    <Reanimated.View
      style={style}
      onLayout={(e) => on.measure(item.id, e.nativeEvent.layout.height)}
    >
      <Row
        label={item.heading}
        sub={item.body.trim() ? item.body.trim() : t.record.addScript}
        onPress={() => on.open(item)}
        last={index === count - 1}
        accessibilityActions={actions}
        onAccessibilityAction={onAction}
        right={
          <View style={st.actions}>
            <IconButton
              name="trash"
              label={t.record.a11yDeleteTopic(item.heading)}
              color={c.dangerText}
              onPress={() => on.remove(item)}
            />
            <GestureDetector gesture={pan}>
              {/* 読み上げではドラッグできないので隠す。代わりに行の操作で動かす。 */}
              <View
                style={st.grip}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Icon name="grip" color={c.textSecondary} />
              </View>
            </GestureDetector>
          </View>
        }
      />
    </Reanimated.View>
  );
});

const st = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', marginRight: -space.md },
  grip: { width: hit.min, height: hit.min, alignItems: 'center', justifyContent: 'center' },
});
