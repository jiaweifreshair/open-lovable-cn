/**
 * 抓取索引（Scrape Index）离线回归测试
 *
 * 目的：
 * - 验证 buildScrapeIndex / selectRelevantScrapeChunks 的确定性行为与体积预算约束
 * - 避免回归到“把整站正文塞进 prompt”导致 98KB 输入上限错误
 *
 * 运行：
 * - node --experimental-strip-types tests/run-scrape-index-tests.ts
 */

import assert from 'node:assert/strict';
import {
  buildScrapeIndex,
  selectRelevantScrapeChunks,
  formatScrapeProfileForPrompt,
  formatScrapeChunksForPrompt,
} from '../utils/scrape-index.ts';

function run() {
  const url = 'https://example.com';

  const markdown = `
# Example Site

Welcome to Example.

## Hero
Build fast. Ship faster.

## Features
- Fast
- Reliable
- Secure

## Pricing
Starter: $0
Pro: $29
Enterprise: Contact sales

## FAQ
Q: Does it support X?
A: Yes.

## Footer
Privacy Policy
Terms of Service
`;

  const scrapeData = {
    metadata: { title: 'Example Site', description: 'Demo', scraper: 'firecrawl' },
    markdown,
  };

  const index = buildScrapeIndex({
    url,
    scrapeData,
    options: { maxChunks: 10, maxChunkChars: 200, maxPreviewChars: 50, maxHeadings: 10 },
  });

  assert.equal(index.profile.url, url);
  assert.ok(index.profile.headings.length > 0);
  assert.ok(index.chunks.length > 0);
  assert.ok(index.chunks.length <= 10);
  for (const c of index.chunks) {
    assert.ok(c.text.length <= 200);
    assert.ok(c.preview.length <= 50);
  }

  const picked = selectRelevantScrapeChunks({
    scrapeIndex: index,
    manifestItem: {
      path: 'src/components/Pricing.jsx',
      description: '价格与套餐区块',
      type: 'component',
      dependencies: [],
    },
    maxChunks: 3,
    maxTotalChars: 280,
    perChunkMaxChars: 140,
  });

  assert.ok(picked.length > 0);
  assert.ok(picked.length <= 3);
  assert.ok(picked.reduce((sum, c) => sum + c.text.length, 0) <= 280);
  assert.ok(picked.some((c) => /pricing/i.test(c.heading || '') || /pricing/i.test(c.text)));

  const profileJson = formatScrapeProfileForPrompt(index.profile);
  const chunksJson = formatScrapeChunksForPrompt(picked);
  assert.doesNotThrow(() => JSON.parse(profileJson));
  assert.doesNotThrow(() => JSON.parse(chunksJson));

  // eslint-disable-next-line no-console
  console.log('[run-scrape-index-tests] ✅ OK');
}

run();
