import { StyleSheet, View } from 'react-native';

import { secToSmp, smp } from '@/domain/time';
import { useT, type Messages } from '@/i18n';
import { hit, space, typography } from '@/ui/tokens';
import { Icon, Text } from '@/ui/components';
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
  const ink = (off: boolean) => keyLook(c, 'neutral', off).ink;
  const accentInk = (off: boolean) => keyLook(c, 'accent', off).ink;

  if (tab === 'edit') {
    const empty = state.total === 0;
    return (
      <View style={st.row}>
        <View style={st.side}>
          <Key
            label={t.a11y.back5}
            caption={t.a11y.back5}
            disabled={empty}
            onPress={() => void ws.seek(smp(Math.max(0, state.playhead - SKIP)))}
            style={st.editKey}
          >
            <Icon name="rewind" color={ink(empty)} />
          </Key>
        </View>
        <View style={st.main}>
          <Key
            label={state.playing ? t.a11y.pause : t.a11y.play}
            caption={state.playing ? t.a11y.pause : t.a11y.play}
            tone="accent"
            disabled={empty}
            onPress={() => void ws.togglePlay()}
            style={st.editKey}
          >
            <Icon name={state.playing ? 'pause' : 'play'} color={accentInk(empty)} />
          </Key>
        </View>
        <View style={st.side}>
          <Key
            label={t.a11y.forward5}
            caption={t.a11y.forward5}
            disabled={empty}
            onPress={() => void ws.seek(smp(Math.min(state.total, state.playhead + SKIP)))}
            style={st.editKey}
          >
            <Icon name="forward" color={ink(empty)} />
          </Key>
        </View>
      </View>
    );
  }

  const s = state.recording;
  const active = s === 'recording' || s === 'paused';
  const interrupted = s === 'interrupted';
  const busy = s === 'preparing' || s === 'stopping';
  const recLabel =
    s === 'preparing'
      ? t.record.statePreparing
      : s === 'stopping'
        ? t.record.stateStopping
        : active || interrupted
          ? t.record.finish
          : t.record.start;
  const pauseOff = !active && !interrupted;
  // 残り容量は録音タブの表示窓に出す。ここに残すのは、保存が止まったときの警告だけ。
  const savingStopped = active && !recCtx.writerOk;

  return (
    <View>
      <View style={st.row}>
        <View style={st.side}>
          <Key
            label={t.record.retake}
            caption={t.record.retake}
            disabled={s !== 'recording' && s !== 'paused'}
            onPress={onRetake}
            style={st.recKey}
          >
            <Icon name="retake" color={ink(s !== 'recording' && s !== 'paused')} />
          </Key>
        </View>
        <View style={st.side}>
          {interrupted ? (
            <Key
              label={t.record.resume}
              caption={t.record.resume}
              onPress={onToggleRec}
              style={st.recKey}
            >
              <Icon name="record" color={ink(false)} />
            </Key>
          ) : (
            <Key
              label={s === 'paused' ? t.record.resume : t.record.pause}
              caption={s === 'paused' ? t.record.resume : t.record.pause}
              disabled={pauseOff}
              onPress={() => void (s === 'paused' ? ws.resumeRecording() : ws.pauseRecording())}
              style={st.recKey}
            >
              <Icon name={s === 'paused' ? 'play' : 'pause'} color={ink(pauseOff)} />
            </Key>
          )}
        </View>
        <View style={st.main}>
          <Key
            label={recLabel}
            caption={recLabel}
            tone="rec"
            busy={busy}
            led={s === 'recording'}
            onPress={interrupted ? onFinishInterrupted : onToggleRec}
            style={st.recKey}
          >
            <Icon name={active || interrupted ? 'stop' : 'record'} color={c.recOnSolid} />
          </Key>
        </View>
      </View>
      {savingStopped ? (
        <Text style={[typography.caption, st.storage, { color: c.dangerText }]}>
          {storageLine(t, recCtx, active)}
        </Text>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  side: { flex: 1, minWidth: 0 },
  main: { flex: 1.5, minWidth: 0 },
  recKey: { width: '100%', height: hit.record },
  editKey: { width: '100%', height: hit.secondary },
  storage: { textAlign: 'center', marginTop: space.sm },
});
