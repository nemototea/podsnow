import type { Messages } from '@/i18n';
import type { IconName } from '@/ui/IconSvg';

import type { AudioInput } from '../../../modules/podsnow-recorder/src/PodsnowRecorder.types';

/**
 * 録音の入力の名前とアイコン（Issue #179）。設定画面・録音画面・編集のシート・入力切替の通知で同じものを出す。
 * 内蔵は OS の名前（エミュレータでは「sdk_gphone64_arm64」）ではなく「内蔵マイク」と出す。
 *
 * @param input 入力。null は「入力が無い」で、内蔵マイクとして扱う（OS が既定の入力を使う）
 */
export function describeInput(
  t: Messages,
  input: AudioInput | null,
): { name: string; icon: IconName } {
  if (!input || input.type === 'builtin') return { name: t.record.builtInMic, icon: 'mic' };
  const name = input.name.trim() || t.record.externalInput;
  return { name, icon: INPUT_ICON[input.type] };
}

const INPUT_ICON: Record<Exclude<AudioInput['type'], 'builtin'>, IconName> = {
  wired: 'headphones',
  usb: 'usb',
  bluetooth: 'bluetooth',
  other: 'mic',
};
