import { useEffect, useState } from 'react';

import type { RecordableEstimate } from '@/domain/storage';
import { RECORDING_FORMAT, type SessionState } from '@/services/recording/RecordingSession';

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
  const { recorder, recording } = useServices();
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
          // 開始の判定と同じ計算（FR-SAFE-5、Issue #165）
          setEstimate(d.estimate);
        })
        .catch(() => alive && setEstimate(null));
    void measure();
    const h = active ? setInterval(() => void measure(), REFRESH_MS) : null;
    return () => {
      alive = false;
      if (h) clearInterval(h);
    };
  }, [active, recording]);

  return {
    input,
    inputKnown,
    channels: RECORDING_FORMAT.channels,
    estimate,
    writerOk,
  };
}
