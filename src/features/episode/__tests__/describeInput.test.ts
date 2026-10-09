import { en } from '@/i18n/en';
import { ja } from '@/i18n/ja';

import { describeInput } from '../describeInput';

const input = (type: 'builtin' | 'wired' | 'bluetooth' | 'usb' | 'other', name = 'Device') => ({
  uid: type,
  name,
  type,
  lowQuality: type === 'bluetooth',
});

describe('録音の入力の名前とアイコン（Issue #179）', () => {
  it('内蔵は端末の名前ではなく「内蔵マイク」', () => {
    expect(describeInput(ja, input('builtin', 'sdk_gphone64_arm64'))).toEqual({
      name: '内蔵マイク',
      icon: 'mic',
    });
    expect(describeInput(en, input('builtin', 'iPhone Microphone')).name).toBe('Built-in mic');
  });

  it('入力が無いときは内蔵マイクとして出す', () => {
    expect(describeInput(ja, null)).toEqual({ name: '内蔵マイク', icon: 'mic' });
  });

  it('外部の入力は OS の名前。種類ごとにアイコンを出し分ける', () => {
    expect(describeInput(ja, input('wired', 'Headset'))).toEqual({
      name: 'Headset',
      icon: 'headphones',
    });
    expect(describeInput(ja, input('usb', 'Yeti')).icon).toBe('usb');
    expect(describeInput(ja, input('bluetooth', 'AirPods')).icon).toBe('bluetooth');
    expect(describeInput(ja, input('other', 'Car')).icon).toBe('mic');
  });

  it('外部の入力で名前が取れないときは「外部マイク」', () => {
    expect(describeInput(ja, input('usb', '  ')).name).toBe('外部マイク');
  });
});
