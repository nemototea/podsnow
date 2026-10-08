import type { HapticKind } from '../HapticsPort';
import { HapticsService } from '../HapticsService';

function setup(enabled: boolean, fail = false) {
  const played: HapticKind[] = [];
  const state = { enabled };
  const service = new HapticsService({
    port: {
      play: (kind) => {
        played.push(kind);
        return fail ? Promise.reject(new Error('unsupported')) : Promise.resolve();
      },
    },
    enabled: () => state.enabled,
  });
  return { service, played, state };
}

describe('HapticsService', () => {
  it('設定がオンなら鳴らす', () => {
    const { service, played } = setup(true);
    service.play('impact');
    service.play('selection');
    expect(played).toEqual(['impact', 'selection']);
  });

  it('設定がオフなら鳴らさない', () => {
    const { service, played } = setup(false);
    service.play('success');
    expect(played).toEqual([]);
  });

  it('設定の変更をその場で反映する', () => {
    const { service, played, state } = setup(true);
    service.play('light');
    state.enabled = false;
    service.play('light');
    expect(played).toEqual(['light']);
  });

  it('端末が非対応で失敗しても例外を投げない', async () => {
    const { service } = setup(true, true);
    expect(() => service.play('warning')).not.toThrow();
    await Promise.resolve();
  });
});
