import { LOCALES } from '@/domain/locale';

import { en } from '../en';
import { ja } from '../ja';
import { messagesFor } from '../resolve';

type Node = Record<string, unknown>;

/** 葉（文字列 / 関数）のパスと種別を集める。 */
function walk(
  node: Node,
  prefix = '',
): Map<string, { kind: 'string' | 'function'; arity: number }> {
  const out = new Map<string, { kind: 'string' | 'function'; arity: number }>();
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.set(path, { kind: 'string', arity: 0 });
    } else if (typeof value === 'function') {
      out.set(path, { kind: 'function', arity: value.length });
    } else if (value !== null && typeof value === 'object') {
      for (const [k, v] of walk(value as Node, path)) out.set(k, v);
    } else {
      throw new Error(`カタログに文字列・関数・オブジェクト以外があります: ${path}`);
    }
  }
  return out;
}

const jaLeaves = walk(ja as unknown as Node);
const enLeaves = walk(en as unknown as Node);

describe('文言カタログ', () => {
  it('ja と en のキー集合が一致する', () => {
    // TypeScript でも縛っているが、`as` で逃げた場合を実行時にも落とす。
    expect([...enLeaves.keys()].sort()).toEqual([...jaLeaves.keys()].sort());
  });

  it('同じキーが同じ種別・同じ引数の数である', () => {
    const mismatches: string[] = [];
    for (const [path, jaLeaf] of jaLeaves) {
      const enLeaf = enLeaves.get(path);
      if (!enLeaf) continue; // 上のテストが報告する
      if (enLeaf.kind !== jaLeaf.kind || enLeaf.arity !== jaLeaf.arity) {
        mismatches.push(
          `${path}: ja=${jaLeaf.kind}/${jaLeaf.arity} en=${enLeaf.kind}/${enLeaf.arity}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it.each(LOCALES)('%s に空の文言が無い', (locale) => {
    const empty: string[] = [];
    for (const [path, leaf] of walk(messagesFor(locale) as unknown as Node)) {
      if (leaf.kind !== 'string') continue;
      const value = path
        .split('.')
        .reduce<unknown>((acc, k) => (acc as Node)[k], messagesFor(locale));
      if (typeof value === 'string' && value.trim() === '') empty.push(path);
    }
    expect(empty).toEqual([]);
  });

  it('関数の文言が引数を実際に使っている（プレースホルダの取り違え検知）', () => {
    const suspicious: string[] = [];
    for (const locale of LOCALES) {
      const catalog = messagesFor(locale) as unknown as Node;
      for (const [path, leaf] of walk(catalog)) {
        if (leaf.kind !== 'function' || leaf.arity === 0) continue;
        const fn = path.split('.').reduce<unknown>((acc, k) => (acc as Node)[k], catalog) as (
          ...args: unknown[]
        ) => string;
        // 各引数に区別できる値を渡し、すべて出力に現れることを確かめる。
        const args = Array.from({ length: leaf.arity }, (_, i) => 1000 + i);
        const rendered = fn(...args);
        const missing = args.filter((a) => !rendered.includes(String(a)));
        if (missing.length) suspicious.push(`${locale}.${path} → "${rendered}"`);
      }
    }
    expect(suspicious).toEqual([]);
  });

  describe('文体（DESIGN_SYSTEM.md §2.2）', () => {
    const rendered = (catalog: Node): [string, string][] =>
      [...walk(catalog)].map(([path, leaf]) => {
        const v = path.split('.').reduce<unknown>((acc, k) => (acc as Node)[k], catalog);
        const text =
          leaf.kind === 'function'
            ? (v as (...a: unknown[]) => string)(...Array.from({ length: leaf.arity }, () => '1'))
            : (v as string);
        return [path, text];
      });
    const ACRONYMS = new Set(['AAC', 'AGC', 'BGM', 'LUFS', 'M4A', 'MVP', 'WAV', 'YYYY']);

    it.each(LOCALES)('%s に全部大文字の語が無い（略語を除く）', (locale) => {
      const found = rendered(messagesFor(locale) as unknown as Node).flatMap(([path, text]) =>
        (text.match(/\b[A-Z][A-Z0-9]{2,}\b/g) ?? [])
          .filter((w) => !ACRONYMS.has(w))
          .map((w) => `${path}: ${w}`),
      );
      expect(found).toEqual([]);
    });

    it('ja に呼びかけ・キャッチコピー調の言い回しが無い', () => {
      const found = rendered(ja as unknown as Node)
        .filter(([, text]) => /しましょう|大丈夫|、ここから|へ。$/.test(text))
        .map(([path, text]) => `${path}: ${text}`);
      expect(found).toEqual([]);
    });

    it('ja の 1 文だけの文言は句点で終えない', () => {
      const found = rendered(ja as unknown as Node)
        .filter(([, text]) => text.endsWith('。') && text.indexOf('。') === text.length - 1)
        .map(([path, text]) => `${path}: ${text}`);
      expect(found).toEqual([]);
    });

    it('en に呼びかけ・感嘆が無い', () => {
      const found = rendered(en as unknown as Node)
        .filter(([, text]) => /Let[’']s|!/.test(text))
        .map(([path, text]) => `${path}: ${text}`);
      expect(found).toEqual([]);
    });
  });
});
