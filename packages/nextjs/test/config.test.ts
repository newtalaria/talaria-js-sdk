import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withTalariaConfig } from '../src/config/index.ts';

describe('withTalariaConfig', () => {
  it('adds server externals and hides browser source maps', () => {
    const config = withTalariaConfig({ serverExternalPackages: ['sharp'] });
    assert.ok(config.serverExternalPackages?.includes('@newtalaria/node'));
    assert.ok(config.serverExternalPackages?.includes('sharp'));
    assert.equal(config.productionBrowserSourceMaps, false);
  });
});
