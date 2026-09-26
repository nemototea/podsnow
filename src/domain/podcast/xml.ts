/**
 * RSS を読むための最小の XML パーサー（Issue #101、REQUIREMENTS.md NFR-10）。
 *
 * 外部ライブラリを使わず、RSS に要る範囲だけを扱う:
 * 要素・属性・テキスト・CDATA・コメント・処理命令・定義済み実体と文字参照。
 *
 * DOCTYPE は読み飛ばし、そこで宣言された実体は**展開しない**（外部実体・実体の爆発を構造的に起こさない）。
 * 未知の実体参照（`&nbsp;` 等）は文字列のまま残す。
 *
 * 形が壊れている（閉じタグの不一致、閉じていない要素）ときは `XmlParseError` を投げる。
 */

export interface XmlElement {
  /** 接頭辞つきの名前（例 `itunes:image`） */
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** 直下のテキストと CDATA をつないだもの（子要素の中身は含まない） */
  text: string;
}

export class XmlParseError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} (at ${offset})`);
    this.name = 'XmlParseError';
  }
}

const PREDEFINED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** 定義済み実体と文字参照だけを展開する。未知の実体はそのまま残す。 */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (m, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
        return m;
      }
      return String.fromCodePoint(cp);
    }
    return PREDEFINED[body] ?? m;
  });
}

const NAME_START = /[A-Za-z_:À-￿]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-·À-￿]/;

export function parseXml(src: string): XmlElement {
  let i = 0;
  const n = src.length;
  // 先頭の BOM
  if (src.charCodeAt(0) === 0xfeff) i = 1;

  const fail = (msg: string): never => {
    throw new XmlParseError(msg, i);
  };

  const skipUntil = (end: string, what: string) => {
    const j = src.indexOf(end, i);
    if (j === -1) fail(`unterminated ${what}`);
    i = j + end.length;
  };

  /** DOCTYPE は内部サブセット `[...]` を含めて読み飛ばす（中の宣言は使わない）。 */
  const skipDoctype = () => {
    let depth = 0;
    for (; i < n; i++) {
      const c = src[i];
      if (c === '[') depth++;
      else if (c === ']') depth--;
      else if (c === '>' && depth <= 0) {
        i++;
        return;
      }
    }
    fail('unterminated DOCTYPE');
  };

  const readName = (): string => {
    const start = i;
    if (i >= n || !NAME_START.test(src[i]!)) fail('expected a name');
    i++;
    while (i < n && NAME_CHAR.test(src[i]!)) i++;
    return src.slice(start, i);
  };

  const skipSpace = () => {
    while (i < n && /\s/.test(src[i]!)) i++;
  };

  /** `<` の直後から、開始タグを読み終えるまで。自己終了なら true。 */
  const readStartTag = (el: XmlElement): boolean => {
    for (;;) {
      skipSpace();
      if (src.startsWith('/>', i)) {
        i += 2;
        return true;
      }
      if (src[i] === '>') {
        i++;
        return false;
      }
      if (i >= n) fail('unterminated start tag');
      const key = readName();
      skipSpace();
      if (src[i] !== '=') fail(`attribute ${key} has no value`);
      i++;
      skipSpace();
      const q = src[i] ?? '';
      if (q !== '"' && q !== "'") fail(`attribute ${key} is not quoted`);
      const end = src.indexOf(q, i + 1);
      if (end === -1) fail(`unterminated attribute ${key}`);
      el.attrs[key] = decodeEntities(src.slice(i + 1, end));
      i = end + 1;
    }
  };

  let root: XmlElement | null = null;
  const stack: XmlElement[] = [];

  while (i < n) {
    const lt = src.indexOf('<', i);
    const textEnd = lt === -1 ? n : lt;
    if (textEnd > i) {
      const top = stack[stack.length - 1];
      const raw = src.slice(i, textEnd);
      if (top) top.text += decodeEntities(raw);
      else if (raw.trim()) fail('text outside the root element');
      i = textEnd;
    }
    if (lt === -1) break;

    if (src.startsWith('<!--', i)) {
      i += 4;
      skipUntil('-->', 'comment');
    } else if (src.startsWith('<![CDATA[', i)) {
      const start = i + 9;
      i = start;
      skipUntil(']]>', 'CDATA');
      const top = stack[stack.length - 1];
      if (!top) fail('CDATA outside the root element');
      top!.text += src.slice(start, i - 3);
    } else if (src.startsWith('<?', i)) {
      i += 2;
      skipUntil('?>', 'processing instruction');
    } else if (src.startsWith('<!DOCTYPE', i) || src.startsWith('<!doctype', i)) {
      i += 9;
      skipDoctype();
    } else if (src.startsWith('</', i)) {
      i += 2;
      const name = readName();
      skipSpace();
      if (src[i] !== '>') fail(`malformed end tag ${name}`);
      i++;
      const top = stack.pop();
      if (!top || top.name !== name) fail(`unexpected end tag ${name}`);
    } else {
      i++;
      const el: XmlElement = { name: readName(), attrs: {}, children: [], text: '' };
      const selfClosing = readStartTag(el);
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(el);
      else if (root) fail('more than one root element');
      else root = el;
      if (!selfClosing) stack.push(el);
    }
  }

  if (stack.length) fail(`unclosed element ${stack[stack.length - 1]!.name}`);
  if (!root) fail('no root element');
  return root!;
}
