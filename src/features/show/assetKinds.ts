import type { Messages } from '@/i18n';
import type { AssetKind } from '@/infra/db/repositories/assetsRepo';

/** 用途別の表示順（PRODUCT.md §7 Show Assets）。ラベルは i18n から引く。 */
export const ASSET_KIND_ORDER: readonly AssetKind[] = ['opening', 'ending', 'jingle', 'sfx', 'bgm'];

export interface AssetKindLabel {
  kind: AssetKind;
  label: string;
}

/** 表示順にラベルを解決した配列。 */
export function assetKinds(t: Messages): readonly AssetKindLabel[] {
  return ASSET_KIND_ORDER.map((kind) => ({ kind, label: t.assetKinds[kind].label }));
}

export function kindLabel(t: Messages, kind: AssetKind): string {
  return t.assetKinds[kind]?.label ?? kind;
}
