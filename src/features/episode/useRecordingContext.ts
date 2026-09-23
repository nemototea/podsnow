import { useEffect, useState } from 'react';

import { estimateRecordable, type RecordableEstimate } from '@/domain/storage';
import {
  DEFAULT_RECORDING_SETTINGS,
  type SessionState,
} from '@/services/recording/RecordingSession';

import type { AudioInput } from '../../../modules/podsnow-recorder/src/PodsnowRecorder.types';
import { useServices } from '../app/ServicesProvider';

const REFRESH_MS = 60_000;

export interface RecordingContext {
  input: AudioInput | null;
  inputKnown: boolean;
  channels: 1 | 2;
  estimate: RecordableEstimate | null;
  writerOk: boolean;
}

export function useRecordingContext(state: SessionState): RecordingContext {
  const { recorder, recording, settings } = useServices();
  const [input, setInput] = useState<AudioInput | null>(null);
  const [inputKnown, setInputKnown] = useState(false);
  const [estimate, setEstimate] = useState<RecordableEstimate | null>(null);
  const [writerOk, setWriterOk] = useState(true);
  const active = state === 'recording' || state === 'paused';

  useEffect(() => {
    let alive = true;
    void recorder
      .getCurrentInput()
      .then((i) => {
        if (!alive) return;
        setInput(i);
        setInputKnown(true);
      })
      .catch(() => alive && setInputKnown(false));
    return () => {
      alive = false;
    };
  }, [recorder, state]);

  useEffect(() => {
    const subs = [
      recording.on('routeChange', (e) => {
        setInput(e.currentInput);
        setInputKnown(true);
      }),
      recording.on('error', () => setWriterOk(false)),
      recording.on('diskLow', () => setWriterOk(false)),
      recording.on('state', (s) => {
        if (s === 'preparing') setWriterOk(true);
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [recording]);

  useEffect(() => {
    let alive = true;
    const measure = () =>
      recording
        .checkDiskSpace()
        .then((d) => {
          if (!alive) return;
          setEstimate(
            estimateRecordable(d.availableBytes, {
              sampleRate: settings.recording.sampleRate,
              channels: settings.recording.channels,
              reserveBytes: DEFAULT_RECORDING_SETTINGS.diskLowThresholdBytes,
            }),
          );
        })
        .catch(() => alive && setEstimate(null));
    void measure();
    const h = active ? setInterval(() => void measure(), REFRESH_MS) : null;
    return () => {
      alive = false;
      if (h) clearInterval(h);
    };
  }, [active, recording, settings.recording.channels, settings.recording.sampleRate]);

  return {
    input,
    inputKnown,
    channels: settings.recording.channels,
    estimate,
    writerOk,
  };
}
