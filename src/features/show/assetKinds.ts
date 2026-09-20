import type { Messages } from '@/i18n';
import type { AssetKind } from '@/infra/db/repositories/assetsRepo';

/** 用途別の表示順（PRODUCT.md §7 Show Assets）。ラベルは i18n から引く。 */
export const ASSET_KIND_ORDER: readonly AssetKind[] = ['opening', 'ending', 'jingle', 'sfx', 'bgm'];

export interface AssetKindLabel {
  kind: AssetKind;
  label: string;
  sub: string;
}

/** 表示順にラベルを解決した配列。 */
export function assetKinds(t: Messages): readonly AssetKindLabel[] {
  return ASSET_KIND_ORDER.map((kind) => ({ kind, ...t.assetKinds[kind] }));
}

export function kindLabel(t: Messages, kind: AssetKind): string {
  return t.assetKinds[kind]?.label ?? kind;
}
