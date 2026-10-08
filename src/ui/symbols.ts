import type { SFSymbol } from 'expo-symbols';

import type { IconName } from './IconSvg';

/**
 * iOS のネイティブのメニューの項目に付ける SF Symbols（DESIGN_SYSTEM.md §6.2）。画面のアイコンは
 * どの OS でも見本の SVG（`IconSvg.tsx`）で描く（Issue #235）。
 * 名前は `sf-symbols-typescript` の型で検査される。意味との対応は DESIGN_SYSTEM.md §6.4。
 * 1 つの記号を 2 つの意味に使わない（テストで検査する）。
 */
export const SYMBOLS: Record<IconName, SFSymbol> = {
  home: 'house.fill',
  search: 'magnifyingglass',
  library: 'books.vertical',
  plus: 'plus',
  minus: 'minus',
  arrow: 'chevron.right',
  back: 'chevron.left',
  chevron: 'chevron.down',
  chevronUp: 'chevron.up',
  grip: 'line.3.horizontal',
  play: 'play.fill',
  skipBack15: 'gobackward.15',
  skipForward30: 'goforward.30',
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
  trimSilence: 'arrow.right.and.line.vertical.and.arrow.left',
  scissors: 'scissors',
  share: 'square.and.arrow.up',
  export: 'arrow.down.doc',
  download: 'square.and.arrow.down',
  artwork: 'photo',
  close: 'xmark',
  refresh: 'arrow.clockwise',
  warning: 'exclamationmark.triangle',
  route: 'arrow.left.arrow.right',
  trash: 'trash',
  star: 'star',
  starFilled: 'star.fill',
  statusNew: 'circle.dashed',
  statusEditing: 'circle.lefthalf.filled',
  published: 'dot.radiowaves.left.and.right',
  noAudio: 'waveform.slash',
  edit: 'pencil',
  info: 'info.circle',
};

export function sfSymbol(name: IconName): SFSymbol {
  return SYMBOLS[name];
}
