import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { secToSmp, smp } from '@/domain/time';
import { useT, type Messages } from '@/i18n';
import {
  hit,
  icon,
  motion,
  pressScale,
  radius,
  space,
  stroke,
  tabularNums,
  typography,
} from '@/ui/tokens';
import { Icon, IconButton, Text, type IconName } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { useReducedMotion } from '@/ui/useReducedMotion';

import type { RecordingContext } from './useRecordingContext';
import type { Workspace } from './useWorkspace';

const SKIP = secToSmp(5);

function storageLine(t: Messages, ctx: RecordingContext, active: boolean): string {
  if (active && !ctx.writerOk) return t.record.savingStopped;
  const left = ctx.estimate
    ? ctx.estimate.unit === 'hours'
      ? t.record.hours(ctx.estimate.value)
      : t.record.minutes(ctx.estimate.value)
    : null;
  if (active) return left ? t.record.savingOnDevice(left) : t.record.savingOnDeviceUnknown;
  return left ? t.record.recordableFor(left) : t.record.freeSpaceUnknown;
}

function RoundButton({
  size,
  label,
  iconName,
  onPress,
  disabled,
  filled,
  busy,
  showLabel = true,
}: {
  size: number;
  label: string;
  iconName: IconName;
  onPress: () => void;
  disabled?: boolean;
  filled?: boolean;
  busy?: boolean;
  showLabel?: boolean;
}) {
  const c = useAppTheme();
  const reduced = useReducedMotion();
  const [held, setHeld] = useState(false);
  const off = disabled || busy;
  const fg = off ? c.textDisabled : filled ? c.recOnSolid : c.textPrimary;
  // 録音・停止は塗りの色が変わらないので、縮小が唯一の押下の手応えになる。
  const pressStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: reduced || off ? 1 : withTiming(held ? pressScale : 1, { duration: motion.instant }),
      },
    ],
  }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setHeld(true)}
      onPressOut={() => setHeld(false)}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={st.round}
    >
      {({ pressed }) => (
        <>
          <Animated.View
            style={[
              pressStyle,
              st.circle,
              {
                width: size,
                height: size,
                borderColor: off ? c.border : filled ? c.recSolid : c.borderStrong,
                backgroundColor: off
                  ? c.surfaceRaised
                  : filled
                    ? c.recSolid
                    : pressed
                      ? c.surfaceHover
                      : 'transparent',
              },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={c.textSecondary} />
            ) : (
              <View style={iconName === 'play' ? st.playNudge : null}>
                <Icon name={iconName} color={fg} size={size > hit.secondary ? icon.lg : icon.md} />
              </View>
            )}
          </Animated.View>
          {showLabel ? (
            <Text
              style={[
                typography.caption,
                st.roundLabel,
                { color: off ? c.textDisabled : c.textSecondary },
              ]}
            >
              {label}
            </Text>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

/**
 * 収録タブの下部。待機中は再生の操作と録音、録音中は一時停止と停止（Issue #122）。
 * 録音は再生位置から始まる。途中なら差し込み、末尾なら足す（FR-REC-1）。
 */
export function Transport({
  ws,
  recCtx,
  onToggleRec,
  onFinishInterrupted,
}: {
  ws: Workspace;
  recCtx: RecordingContext;
  onToggleRec: () => void;
  onFinishInterrupted: () => void;
}) {
  const c = useAppTheme();
  const t = useT();
  const { state } = ws;

  const s = state.recording;
  const active = s === 'recording' || s === 'paused';
  const interrupted = s === 'interrupted';
  const busy = s === 'preparing' || s === 'stopping';
  const idle = s === 'idle';
  const line = storageLine(t, recCtx, active);
  const empty = state.total === 0;
  const inMiddle = state.playhead < state.total;

  return (
    <View>
      <View style={st.row}>
        {idle ? (
          <>
            <View style={st.side}>
              <IconButton
                name="rewind"
                label={t.a11y.back5}
                disabled={empty}
                onPress={() => void ws.seek(smp(Math.max(0, state.playhead - SKIP)))}
              />
            </View>
            <RoundButton
              size={hit.secondary}
              label={state.playing ? t.a11y.pause : t.a11y.play}
              iconName={state.playing ? 'pause' : 'play'}
              disabled={empty}
              onPress={() => void ws.togglePlay()}
            />
            <View style={st.side}>
              <IconButton
                name="forward"
                label={t.a11y.forward5}
                disabled={empty}
                onPress={() => void ws.seek(smp(Math.min(state.total, state.playhead + SKIP)))}
              />
            </View>
          </>
        ) : interrupted ? (
          <RoundButton
            size={hit.secondary}
            label={t.record.resume}
            iconName="record"
            onPress={onToggleRec}
          />
        ) : (
          <RoundButton
            size={hit.secondary}
            label={s === 'paused' ? t.record.resume : t.record.pause}
            iconName={s === 'paused' ? 'play' : 'pause'}
            disabled={!active}
            onPress={() => void (s === 'paused' ? ws.resumeRecording() : ws.pauseRecording())}
          />
        )}
        <RoundButton
          size={hit.record}
          filled
          busy={busy}
          label={
            s === 'preparing'
              ? t.record.statePreparing
              : s === 'stopping'
                ? t.record.stateStopping
                : active || interrupted
                  ? t.record.finish
                  : inMiddle
                    ? t.record.startHere
                    : t.record.start
          }
          iconName={active || interrupted ? 'stop' : 'record'}
          onPress={interrupted ? onFinishInterrupted : onToggleRec}
        />
      </View>
      <Text
        style={[
          typography.caption,
          tabularNums,
          st.storage,
          { color: active && !recCtx.writerOk ? c.dangerText : c.textTertiary },
        ]}
      >
        {line}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-evenly',
    gap: space.md,
  },
  side: { minHeight: hit.record, justifyContent: 'center' },
  round: { alignItems: 'center', minWidth: hit.record, gap: space.xs },
  circle: {
    borderRadius: radius.pill,
    borderWidth: stroke.selected,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundLabel: { textAlign: 'center' },
  // 三角は重心が左に寄るので、丸の中で右へ寄せて光学的に中央へ置く。
  // SVG（Android・Web）は字形の側で重心を中央に置いてあるので、SF Symbols（iOS）だけ。
  playNudge: Platform.OS === 'ios' ? { transform: [{ translateX: space.hair }] } : {},
  storage: { textAlign: 'center', marginTop: space.sm },
});
