import type { AssetKind } from '@/infra/db/repositories/assetsRepo';

/** 用途別の表示順とラベル（PRODUCT.md §7 Show Assets）。 */
export const ASSET_KINDS: readonly { kind: AssetKind; label: string; sub: string }[] = [
  { kind: 'opening', label: 'OPENING', sub: '番組冒頭の固定音声' },
  { kind: 'ending', label: 'ENDING', sub: '番組終了時の固定音声' },
  { kind: 'jingle', label: 'JINGLES', sub: '話題転換など。★はクイック挿入の先頭に出ます' },
  { kind: 'sfx', label: '効果音', sub: '短い効果音' },
  { kind: 'bgm', label: 'BGM', sub: '会話の背景音。しゃべり中は自動で下がります' },
];

export function kindLabel(kind: AssetKind): string {
  return ASSET_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}
