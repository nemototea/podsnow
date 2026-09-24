import type { AudioInput } from '../../../../modules/podsnow-recorder/src/PodsnowRecorder.types';
import { selectableInputs } from '../inputs';

const input = (uid: string, type: AudioInput['type'], name: string): AudioInput => ({
  uid,
  name,
  type,
  lowQuality: type === 'bluetooth',
});

describe('selectableInputs', () => {
  it('同じ種類・同じ名前の入力は最初の 1 件だけ残す（Android の内蔵マイク × 位置）', () => {
    const out = selectableInputs([
      input('1', 'builtin', 'Pixel 9a'),
      input('2', 'other', 'Pixel 9a'),
      input('3', 'builtin', 'Pixel 9a'),
      input('4', 'other', 'Pixel 9a'),
    ]);
    expect(out.map((i) => i.uid)).toEqual(['1', '2']);
  });

  it('種類か名前が違えば残す', () => {
    const out = selectableInputs([
      input('1', 'builtin', 'Pixel 9a'),
      input('2', 'usb', 'Pixel 9a'),
      input('3', 'usb', 'Yeti'),
    ]);
    expect(out.map((i) => i.uid)).toEqual(['1', '2', '3']);
  });

  it('空の一覧はそのまま', () => {
    expect(selectableInputs([])).toEqual([]);
  });
});
