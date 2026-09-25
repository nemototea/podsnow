import type { SFSymbol } from 'expo-symbols';

import type { IconName } from './IconSvg';

/**
 * iOS は SF Symbols で描く（DESIGN_SYSTEM.md §6.2）。文字の太さと大きさに合わせて OS が線を調整する。
 * 名前は `sf-symbols-typescript` の型で検査される。
 */
export const SYMBOLS: Record<IconName, SFSymbol> = {
  plus: 'plus',
  minus: 'minus',
  arrow: 'chevron.right',
  back: 'chevron.left',
  chevron: 'chevron.down',
  chevronUp: 'chevron.up',
  up: 'arrow.up',
  down: 'arrow.down',
  grip: 'line.3.horizontal',
  play: 'play.fill',
  pause: 'pause.fill',
  stop: 'stop.fill',
  record: 'circle.fill',
  flag: 'flag',
  check: 'checkmark',
  copy: 'doc.on.doc',
  settings: 'gearshape',
  more: 'ellipsis',
  music: 'music.note',
  headphones: 'headphones',
  mic: 'mic',
  undo: 'arrow.uturn.backward',
  redo: 'arrow.uturn.forward',
  retake: 'arrow.counterclockwise',
  scissors: 'scissors',
  share: 'square.and.arrow.up',
  download: 'square.and.arrow.down',
  episodes: 'square.stack',
  show: 'play.rectangle',
  close: 'xmark',
  volume: 'speaker.wave.2',
  refresh: 'arrow.clockwise',
  warning: 'exclamationmark.triangle',
  trash: 'trash',
  star: 'star',
  starFilled: 'star.fill',
  archive: 'archivebox',
  edit: 'pencil',
};

export function sfSymbol(name: IconName): SFSymbol {
  return SYMBOLS[name];
}
