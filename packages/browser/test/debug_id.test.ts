import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { debugMetaForFrames } from '../src/utils/debug_id.js';

describe('debug id registry', () => {
  it('attaches the id for the script URL that threw', () => {
    const meta = debugMetaForFrames(
      [
        {
          absPath: 'https://cdn.example/static/app.js',
          filename: 'app.js',
        },
      ],
      {
        'https://cdn.example/static/app.js?v=1':
          '11111111-1111-4111-8111-111111111111',
      },
    );
    assert.equal(meta?.images?.length, 1);
    assert.equal(
      meta?.images?.[0]?.debugId,
      '11111111-1111-4111-8111-111111111111',
    );
    assert.equal(
      meta?.images?.[0]?.codeFile,
      'https://cdn.example/static/app.js',
    );
    assert.equal(meta?.images?.[0]?.type, 'sourcemap');
  });

  it('skips a frame with no registered script', () => {
    const meta = debugMetaForFrames(
      [{ absPath: 'https://cdn.example/other/app.js', filename: 'app.js' }],
      { 'https://cdn.example/static/app.js': 'debug-1' },
    );
    assert.equal(meta, undefined);
  });
});
