import { SYMBOLS } from '../symbols';

describe('アイコンと意味の対応（DESIGN_SYSTEM.md §6.4、Issue #171）', () => {
  it('1 つの SF Symbol を 2 つの意味に使わない', () => {
    const byName = new Map<string, string[]>();
    for (const [meaning, symbol] of Object.entries(SYMBOLS)) {
      byName.set(symbol, [...(byName.get(symbol) ?? []), meaning]);
    }
    const shared = [...byName.entries()].filter(([, meanings]) => meanings.length > 1);
    expect(shared).toEqual([]);
  });

  it('秒数入りの戻る・進むは、画面移動の山形と別の形', () => {
    expect(SYMBOLS.skipBack15).toBe('gobackward.15');
    expect(SYMBOLS.skipForward30).toBe('goforward.30');
    expect([SYMBOLS.back, SYMBOLS.arrow]).not.toContain(SYMBOLS.skipBack15);
    expect([SYMBOLS.back, SYMBOLS.arrow]).not.toContain(SYMBOLS.skipForward30);
  });
});
