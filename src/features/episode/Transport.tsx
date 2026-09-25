import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { secToSmp, smp } from '@/domain/time';
import { useT, type Messages } from '@/i18n';
import { hit, icon, radius, space, stroke, typography } from '@/ui/tokens';
import { Icon, IconButton, Text, type IconName } from '@/ui/components';
import { Key, keyLook } from '@/ui/device';
import { useAppTheme } from '@/ui/ThemeContext';

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
  const off = disabled || busy;
  const fg = off ? c.textDisabled : filled ? c.recOnSolid : c.textPrimary;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={st.round}
    >
      {({ pressed }) => (
        <>
          <View
            style={[
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
              <Icon name={iconName} color={fg} size={size > hit.secondary ? icon.lg : icon.md} />
            )}
          </View>
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

export function Transport({
  tab,
  ws,
  recCtx,
  onToggleRec,
  onFinishInterrupted,
  onRetake,
}: {
  tab: 'record' | 'edit';
  ws: Workspace;
  recCtx: RecordingContext;
  onToggleRec: () => void;
  onFinishInterrupted: () => void;
  onRetake: () => void;
}) {
  const c = useAppTheme();
  const t = useT();
  const { state } = ws;

  if (tab === 'edit') {
    // 編集タブだけは録音機のキーで並べる（PN-01、#115。DESIGN_SYSTEM.md §6.3）
    const empty = state.total === 0;
    const ink = keyLook(c, 'neutral', empty).ink;
    return (
      <View style={st.keys}>
        <View style={st.keySide}>
          <Key
            label={t.a11y.back5}
            caption={t.a11y.back5}
            disabled={empty}
            onPress={() => void ws.seek(smp(Math.max(0, state.playhead - SKIP)))}
            style={st.key}
          >
            <Icon name="rewind" color={ink} />
          </Key>
        </View>
        <View style={st.keyMain}>
          <Key
            label={state.playing ? t.a11y.pause : t.a11y.play}
            caption={state.playing ? t.a11y.pause : t.a11y.play}
            tone="accent"
            disabled={empty}
            onPress={() => void ws.togglePlay()}
            style={st.key}
          >
            <Icon name={state.playing ? 'pause' : 'play'} color={keyLook(c, 'accent', empty).ink} />
          </Key>
        </View>
        <View style={st.keySide}>
          <Key
            label={t.a11y.forward5}
            caption={t.a11y.forward5}
            disabled={empty}
            onPress={() => void ws.seek(smp(Math.min(state.total, state.playhead + SKIP)))}
            style={st.key}
          >
            <Icon name="forward" color={ink} />
          </Key>
        </View>
      </View>
    );
  }

  const s = state.recording;
  const active = s === 'recording' || s === 'paused';
  const interrupted = s === 'interrupted';
  const busy = s === 'preparing' || s === 'stopping';
  const line = storageLine(t, recCtx, active);

  return (
    <View>
      <View style={st.row}>
        <View style={st.side}>
          <IconButton
            name="retake"
            label={t.record.retake}
            showLabel
            disabled={s !== 'recording' && s !== 'paused'}
            onPress={onRetake}
          />
        </View>
        {interrupted ? (
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
                  : t.record.start
          }
          iconName={active || interrupted ? 'stop' : 'record'}
          onPress={interrupted ? onFinishInterrupted : onToggleRec}
        />
      </View>
      <Text
        style={[
          typography.caption,
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
  keys: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  keySide: { flex: 1, minWidth: 0 },
  keyMain: { flex: 1.5, minWidth: 0 },
  key: { width: '100%', height: hit.secondary },
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
  storage: { textAlign: 'center', marginTop: space.sm },
});
