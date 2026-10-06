// テストだけで使う。番組の色のテストで、極端なアートワークの代わりに振る代表色。

/** 色相・彩度・明るさを一通り振った代表色（極端なアートワークの代わり）。 */
export function sweep(): string[] {
  const out: string[] = ['#000000', '#FFFFFF', '#808080'];
  for (let h = 0; h < 360; h += 15) {
    for (const s of [0.3, 0.7, 1]) {
      for (const l of [0.15, 0.5, 0.85]) {
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = l - c / 2;
        const [r, g, b] =
          h < 60
            ? [c, x, 0]
            : h < 120
              ? [x, c, 0]
              : h < 180
                ? [0, c, x]
                : h < 240
                  ? [0, x, c]
                  : h < 300
                    ? [x, 0, c]
                    : [c, 0, x];
        out.push(
          '#' +
            [r + m, g + m, b + m]
              .map((v) => `0${Math.round(v * 255).toString(16)}`.slice(-2))
              .join(''),
        );
      }
    }
  }
  return out;
}
