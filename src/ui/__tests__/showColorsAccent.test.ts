import { contrastHex, deriveShowColors } from '@/domain/color/showColors';
import { sweep } from '@/domain/color/__tests__/sweep';

import { colors } from '../tokens';

// 番組の色の上に置く主操作のレモン（DESIGN_SYSTEM.md §2.6）。番組の色は domain、レモンは UI のトークン。
describe('番組の色とアクセント', () => {
  it.each(sweep())(
    '%s: 主操作のレモンは番組画面・ミニプレーヤーの上で 3:1 以上ある',
    (dominant) => {
      const c = deriveShowColors(dominant);
      for (const role of ['header', 'nowPlaying', 'miniPlayer'] as const) {
        expect({ role, ok: contrastHex(colors.dark.accentSolid, c[role]) >= 3 }).toEqual({
          role,
          ok: true,
        });
      }
    },
  );
});
