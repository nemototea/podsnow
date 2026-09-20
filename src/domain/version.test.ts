import { APP_VERSION } from './version';

describe('version', () => {
  it('is semver', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
