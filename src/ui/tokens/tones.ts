import type { Colors } from './colors';

/**
 * 分類を表す色のひとまとまり（チップ、バッジ、波形のマーカー）。
 *
 * 文字・輪郭・地を別々に選ばせない。別々に選べると、その場で見栄えのいい組み合わせが
 * 選ばれて、測っていない組み合わせが増える。ここに並んだ組み合わせは
 * `scripts/design/generate.py` と `src/ui/__tests__/tokens.test.ts` の両方で測っている。
 */
export interface Tone {
  /** 地の上に載せる文字。 */
  text: string;
  /** 輪郭。 */
  border: string;
  /** 淡い地。 */
  subtle: string;
  /** 塗り。波形のマーカーやインジケータ。 */
  solid: string;
}

export type ToneName =
  'accent' | 'danger' | 'rec' | 'success' | 'voice' | 'music' | 'insert' | 'mistake';

export function tone(c: Colors, name: ToneName): Tone {
  if (name === 'rec' || name === 'success') {
    return {
      text: c[`${name}Text`],
      border: c[`${name}Solid`],
      subtle: c[`${name}Subtle`],
      solid: c[`${name}Solid`],
    };
  }
  return {
    text: c[`${name}Text`],
    border: c[`${name}Border`],
    subtle: c[`${name}Subtle`],
    solid: c[`${name}Solid`],
  };
}
