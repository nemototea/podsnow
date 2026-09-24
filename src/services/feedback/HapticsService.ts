import type { HapticKind, HapticsPort } from './HapticsPort';

/**
 * 設定の「ハプティクス」に従って触覚を鳴らす。
 *
 * 触覚は操作の結果を補うだけで、失敗しても操作は続ける（端末が非対応、低電力モードなど）。
 */
export class HapticsService {
  constructor(
    private readonly deps: {
      port: HapticsPort;
      enabled: () => boolean;
    },
  ) {}

  play(kind: HapticKind): void {
    if (!this.deps.enabled()) return;
    this.deps.port.play(kind).catch(() => undefined);
  }
}
