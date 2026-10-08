import type { Smp } from './time';

/**
 * トークテーマと台本（REQUIREMENTS.md §2.2.1、DATA_MODEL.md §4.11）。
 *
 * 「収録スタイル」という状態は持たない。`body` が空なら見出しだけの項目、
 * 項目が 0 件ならフリートーク。モードではなく、入力されたかどうかだけがある。
 */
export interface OutlineItem {
  id: string;
  heading: string;
  /** 台本本文。空文字なら見出しだけの項目。 */
  body: string;
  /** 録音中にこの項目へ進んだ位置（= チャプターの始まり）。未録音なら null。 */
  recordedTakeId: string | null;
  recordedSrcSmp: Smp | null;
  doneAt: number | null;
}

/** 箇条書き記号・番号・見出し記号の接頭辞。貼り付けたメモをそのまま使えるように落とす。 */
const BULLET = /^\s*(?:[-*+•・‣]|#{1,6}|\d+[.)、]|[(（]\d+[)）])\s*/;

/**
 * 複数行のテキストを項目の見出しに割る（FR-OUT-3）。
 * 空行は捨て、行頭の箇条書き記号と番号は落とす。
 */
export function splitIntoHeadings(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(BULLET, '').trim())
    .filter((line) => line.length > 0);
}

/** 並べ替え。範囲外の指定は何もしない。 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** 録音済み（チャプターが付いた）項目か。 */
export function isRecorded(item: OutlineItem): boolean {
  return item.recordedTakeId !== null && item.recordedSrcSmp !== null;
}

/**
 * いま話している項目の位置。録音中に「次へ」を押すたびに進む。
 * まだ 1 つも進んでいなければ null。
 */
export function currentIndex(items: readonly OutlineItem[]): number | null {
  let found: number | null = null;
  for (let i = 0; i < items.length; i++) if (isRecorded(items[i]!)) found = i;
  return found;
}

/** 次に話す項目の位置。全部話し終えていれば null。 */
export function nextIndex(items: readonly OutlineItem[]): number | null {
  const cur = currentIndex(items);
  const from = cur === null ? 0 : cur + 1;
  return from < items.length ? from : null;
}

/** 概要欄の {{topics}} に差し込む見出しの列（FR-OUT-5）。 */
export function headings(items: readonly OutlineItem[]): string[] {
  return items.map((i) => i.heading.trim()).filter((h) => h.length > 0);
}

/** 台本（本文）を持つ項目が 1 つでもあるか。表示の切り替えに使う。 */
export function hasScript(items: readonly OutlineItem[]): boolean {
  return items.some((i) => i.body.trim().length > 0);
}

export function newItem(id: string, heading: string, body = ''): OutlineItem {
  return { id, heading, body, recordedTakeId: null, recordedSrcSmp: null, doneAt: null };
}
