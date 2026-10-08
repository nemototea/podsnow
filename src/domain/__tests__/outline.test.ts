import {
  currentIndex,
  hasScript,
  headings,
  moveItem,
  newItem,
  nextIndex,
  splitIntoHeadings,
  type OutlineItem,
} from '../outline';
import { smp } from '../time';

describe('splitIntoHeadings', () => {
  it('改行で割り、空行を捨てる', () => {
    expect(splitIntoHeadings('近況\n\n最近読んだ本\n  お便り  ')).toEqual([
      '近況',
      '最近読んだ本',
      'お便り',
    ]);
  });

  it('箇条書き記号と番号を落とす', () => {
    const text = ['- 近況', '* 告知', '・お便り', '1. 本題', '2) まとめ', '（3）エンディング'].join(
      '\n',
    );
    expect(splitIntoHeadings(text)).toEqual([
      '近況',
      '告知',
      'お便り',
      '本題',
      'まとめ',
      'エンディング',
    ]);
  });

  it('Markdown の見出し記号も落とす', () => {
    expect(splitIntoHeadings('## オープニング\n### 本題')).toEqual(['オープニング', '本題']);
  });

  it('記号だけの行は残さない', () => {
    expect(splitIntoHeadings('-\n \n・')).toEqual([]);
  });

  it('CRLF でも割れる', () => {
    expect(splitIntoHeadings('a\r\nb')).toEqual(['a', 'b']);
  });
});

describe('moveItem', () => {
  const items = ['a', 'b', 'c'];
  it('前へ動かす', () => expect(moveItem(items, 2, 0)).toEqual(['c', 'a', 'b']));
  it('後ろへ動かす', () => expect(moveItem(items, 0, 2)).toEqual(['b', 'c', 'a']));
  it('範囲外は何もしない', () => {
    expect(moveItem(items, 0, 9)).toEqual(items);
    expect(moveItem(items, -1, 0)).toEqual(items);
    expect(moveItem(items, 1, 1)).toEqual(items);
  });
  it('元の配列を変えない', () => {
    moveItem(items, 0, 2);
    expect(items).toEqual(['a', 'b', 'c']);
  });
});

describe('現在位置と次の項目', () => {
  const recorded = (id: string, at: number): OutlineItem => ({
    ...newItem(id, id),
    recordedTakeId: 't1',
    recordedSrcSmp: smp(at),
  });

  it('1 つも録っていなければ current は null、next は先頭', () => {
    const items = [newItem('1', 'a'), newItem('2', 'b')];
    expect(currentIndex(items)).toBeNull();
    expect(nextIndex(items)).toBe(0);
  });

  it('最後に進んだ項目が current', () => {
    const items = [recorded('1', 0), recorded('2', 48000), newItem('3', 'c')];
    expect(currentIndex(items)).toBe(1);
    expect(nextIndex(items)).toBe(2);
  });

  it('全部話し終えたら next は null', () => {
    const items = [recorded('1', 0), recorded('2', 100)];
    expect(nextIndex(items)).toBeNull();
  });

  it('空なら両方 null', () => {
    expect(currentIndex([])).toBeNull();
    expect(nextIndex([])).toBeNull();
  });
});

describe('headings / hasScript', () => {
  it('空の見出しは概要に差し込まない', () => {
    expect(headings([newItem('1', ' 近況 '), newItem('2', '  ')])).toEqual(['近況']);
  });

  it('本文がある項目が 1 つでもあれば台本扱い', () => {
    expect(hasScript([newItem('1', 'a'), newItem('2', 'b', '本文')])).toBe(true);
    expect(hasScript([newItem('1', 'a'), newItem('2', 'b', '   ')])).toBe(false);
  });
});
