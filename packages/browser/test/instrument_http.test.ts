import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isNoisyBrowserSpanUrl,
  isTalariaIngestUrl,
  shouldInjectTraceparent,
} from '../src/tracing/instrument_http.ts';

const PAGE = 'https://app.example.com';

describe('shouldInjectTraceparent', () => {
  it('injects same-origin and allowlisted origins only', () => {
    assert.equal(
      shouldInjectTraceparent('https://app.example.com/api', {
        networkErrorOrigins: [],
        pageOrigin: PAGE,
        talariaBaseUrl: 'https://api.newtalaria.com',
      }),
      true,
    );
    assert.equal(
      shouldInjectTraceparent('https://api.stripe.com/v1', {
        networkErrorOrigins: ['https://api.stripe.com'],
        pageOrigin: PAGE,
        talariaBaseUrl: 'https://api.newtalaria.com',
      }),
      true,
    );
    assert.equal(
      shouldInjectTraceparent('https://www.google-analytics.com/g/collect', {
        networkErrorOrigins: [],
        pageOrigin: PAGE,
        talariaBaseUrl: 'https://api.newtalaria.com',
      }),
      false,
    );
  });

  it('never injects on Talaria span/event ingest URLs', () => {
    assert.equal(
      shouldInjectTraceparent('https://api.newtalaria.com/spans/ingestBatch', {
        networkErrorOrigins: ['*'],
        pageOrigin: PAGE,
        talariaBaseUrl: 'https://api.newtalaria.com',
      }),
      false,
    );
    assert.equal(
      shouldInjectTraceparent('https://api.newtalaria.com/events/ingest', {
        networkErrorOrigins: ['*'],
        pageOrigin: PAGE,
        talariaBaseUrl: 'https://api.newtalaria.com',
      }),
      false,
    );
  });
});

describe('isNoisyBrowserSpanUrl', () => {
  it('drops Next.js RSC/prefetch and Cloudflare RUM', () => {
    assert.equal(
      isNoisyBrowserSpanUrl('https://www.newtalaria.com/docs/__next._tree.txt'),
      true,
    );
    assert.equal(
      isNoisyBrowserSpanUrl(
        'https://www.newtalaria.com/learn/sdk-native-apm/__next.learn.$d$slug.__PAGE__.txt',
      ),
      true,
    );
    assert.equal(
      isNoisyBrowserSpanUrl('https://www.newtalaria.com/_next/static/chunks/app.js'),
      true,
    );
    assert.equal(
      isNoisyBrowserSpanUrl('https://www.newtalaria.com/cdn-cgi/rum'),
      true,
    );
    assert.equal(
      isNoisyBrowserSpanUrl(
        'https://www.newtalaria.com/docs/__next.learn.$d$slug.__PAGE__.txt',
      ),
      true,
    );
  });

  it('keeps real first-party page and API requests', () => {
    assert.equal(isNoisyBrowserSpanUrl('https://www.newtalaria.com/features'), false);
    assert.equal(isNoisyBrowserSpanUrl('https://www.newtalaria.com/api/contact'), false);
    assert.equal(isNoisyBrowserSpanUrl('HEAD leftover path'), false);
  });
});

describe('isTalariaIngestUrl', () => {
  const opts = { talariaBaseUrl: 'https://api.newtalaria.com' };

  it('matches span and event ingest so they are not auto-traced', () => {
    assert.equal(
      isTalariaIngestUrl('https://api.newtalaria.com/spans/ingestBatch', opts),
      true,
    );
    assert.equal(
      isTalariaIngestUrl('https://api.newtalaria.com/events/ingestBatch', opts),
      true,
    );
    assert.equal(
      isTalariaIngestUrl('https://www.newtalaria.com/api/contact', opts),
      false,
    );
  });
});
