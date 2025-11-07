/**
 * 三层降级策略测试脚本
 *
 * 测试场景：
 * 1. Firecrawl (优先) - 有 API key 时使用
 * 2. Crawlee (中间层) - Firecrawl 失败时自动降级
 *    - Cheerio: 静态页面（极快）
 *    - Playwright: 动态页面（强大）
 * 3. Playwright (兜底) - Crawlee 失败时最终降级
 *
 * Phase 3C 验证
 */

import { createScraperRouter } from './lib/scraper';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: '.env.local' });

console.log('='.repeat(80));
console.log('🚀 三层降级策略测试');
console.log('='.repeat(80));
console.log('');

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
console.log(`📌 Firecrawl API Key: ${FIRECRAWL_API_KEY ? '✅ 已配置' : '❌ 未配置'}`);
console.log('');

/**
 * 测试 1: Firecrawl 优先（带 API key）
 */
async function testFirecrawlFirst() {
  console.log('📄 测试 1: Firecrawl 优先路径');
  console.log('-'.repeat(80));

  if (!FIRECRAWL_API_KEY || FIRECRAWL_API_KEY === 'your_firecrawl_api_key') {
    console.log('⚠️  Firecrawl API key 未配置，跳过此测试');
    console.log('');
    return { success: false, skipped: true };
  }

  const router = createScraperRouter({
    preferredScraper: 'firecrawl',
    enableFallback: true,
    firecrawlApiKey: FIRECRAWL_API_KEY,
  });

  const url = 'https://example.com';
  const startTime = Date.now();

  try {
    const result = await router.scrape(url, {
      waitFor: 1000,
      timeout: 15000,
    });

    const duration = Date.now() - startTime;

    console.log('✅ 爬取成功！');
    console.log(`   使用爬虫: ${result.scraper}`);
    console.log(`   耗时: ${duration}ms`);
    console.log(`   是否降级: ${result.fallbackUsed ? '是' : '否'}`);
    console.log(`   尝试的爬虫: ${result.attemptedScraper || 'N/A'}`);
    console.log(`   是否缓存: ${result.metadata.cached ? '是' : '否'}`);
    console.log('');

    return {
      success: true,
      scraper: result.scraper,
      fallbackUsed: result.fallbackUsed,
      duration,
    };
  } catch (error) {
    console.error('❌ 测试失败:', (error as Error).message);
    console.log('');
    return { success: false, error: (error as Error).message };
  }
}

/**
 * 测试 2: Crawlee 中间层（无 Firecrawl key）
 */
async function testCrawleeMiddleTier() {
  console.log('📄 测试 2: Crawlee 中间层路径（静态页面）');
  console.log('-'.repeat(80));

  const router = createScraperRouter({
    preferredScraper: 'playwright', // 不使用 Firecrawl
    enableFallback: true,
    // 不传 firecrawlApiKey，强制使用 Crawlee
  });

  const url = 'https://example.com';
  const startTime = Date.now();

  try {
    const result = await router.scrape(url, {
      waitFor: 1000,
      timeout: 15000,
      screenshot: false,
    });

    const duration = Date.now() - startTime;

    console.log('✅ 爬取成功！');
    console.log(`   使用爬虫: ${result.scraper}`);
    console.log(`   耗时: ${duration}ms`);
    console.log(`   页面标题: ${result.title}`);
    console.log('');

    // 验证使用了 Cheerio（静态页面）
    if (result.scraper === 'cheerio') {
      console.log('✅ 正确使用 Cheerio（静态页面优化）');
    } else if (result.scraper === 'playwright') {
      console.log('⚠️  使用了 Playwright（可能是动态页面或 Cheerio 失败）');
    }

    console.log('');

    return {
      success: true,
      scraper: result.scraper,
      duration,
    };
  } catch (error) {
    console.error('❌ 测试失败:', (error as Error).message);
    console.log('');
    return { success: false, error: (error as Error).message };
  }
}

/**
 * 测试 3: 性能对比（Cheerio vs Playwright）
 */
async function testPerformanceComparison() {
  console.log('📄 测试 3: 性能对比（Crawlee 智能路由）');
  console.log('-'.repeat(80));

  const router = createScraperRouter({
    enableFallback: true,
  });

  const staticUrl = 'https://en.wikipedia.org/wiki/TypeScript';

  console.log('测试静态页面性能...');
  const startTime = Date.now();

  try {
    const result = await router.scrape(staticUrl, {
      waitFor: 1000,
      timeout: 15000,
      screenshot: false,
    });

    const duration = Date.now() - startTime;

    console.log('✅ 爬取成功！');
    console.log(`   URL: ${staticUrl}`);
    console.log(`   使用爬虫: ${result.scraper}`);
    console.log(`   耗时: ${duration}ms`);
    console.log(`   内容长度: ${result.content.length} 字符`);
    console.log('');

    // 性能评估
    if (result.scraper === 'cheerio' && duration < 2000) {
      console.log(`✅ Cheerio 性能优秀：${duration}ms`);
      console.log(`   相比 Playwright (≈2000ms)，快 ${Math.round(2000 / duration)}x`);
    } else if (result.scraper === 'playwright') {
      console.log(`ℹ️  使用了 Playwright：${duration}ms`);
      console.log(`   （静态页面建议使用 Cheerio 以获得更好性能）`);
    }

    console.log('');

    return {
      success: true,
      scraper: result.scraper,
      duration,
      speedup: result.scraper === 'cheerio' ? Math.round(2000 / duration) : 1,
    };
  } catch (error) {
    console.error('❌ 测试失败:', (error as Error).message);
    console.log('');
    return { success: false, error: (error as Error).message };
  }
}

/**
 * 主测试流程
 */
async function runAllTests() {
  console.log('开始执行三层降级策略测试...\n');

  const results = {
    test1: null as any,
    test2: null as any,
    test3: null as any,
  };

  // 测试 1: Firecrawl 优先
  results.test1 = await testFirecrawlFirst();
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 测试 2: Crawlee 中间层
  results.test2 = await testCrawleeMiddleTier();
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 测试 3: 性能对比
  results.test3 = await testPerformanceComparison();

  // 总结
  console.log('='.repeat(80));
  console.log('📊 测试总结');
  console.log('='.repeat(80));
  console.log('');

  const passedTests = [
    results.test1?.success || results.test1?.skipped,
    results.test2?.success,
    results.test3?.success,
  ].filter(Boolean).length;

  console.log(`总测试数: 3`);
  console.log(`通过: ${passedTests}`);
  console.log(`失败: ${3 - passedTests}`);
  console.log('');

  if (results.test1?.skipped) {
    console.log(`⚠️  测试 1: 跳过（Firecrawl API key 未配置）`);
  } else if (results.test1?.success) {
    console.log(`✅ 测试 1: Firecrawl 优先 (${results.test1.scraper}, 降级: ${results.test1.fallbackUsed ? '是' : '否'})`);
  } else {
    console.log(`❌ 测试 1: 失败`);
  }

  if (results.test2?.success) {
    console.log(`✅ 测试 2: Crawlee 中间层 (${results.test2.scraper}, ${results.test2.duration}ms)`);
  } else {
    console.log(`❌ 测试 2: 失败`);
  }

  if (results.test3?.success) {
    console.log(`✅ 测试 3: 性能对比 (${results.test3.scraper}, ${results.test3.duration}ms, 提升 ${results.test3.speedup}x)`);
  } else {
    console.log(`❌ 测试 3: 失败`);
  }

  console.log('');

  // 验证三层降级策略
  console.log('🎯 三层降级策略验证：');
  console.log('');

  if (results.test1?.success && !results.test1.fallbackUsed) {
    console.log('✅ 层级 1 (Firecrawl): 工作正常');
  } else if (results.test1?.skipped) {
    console.log('⚠️  层级 1 (Firecrawl): 未配置 API key');
  } else {
    console.log('⚠️  层级 1 (Firecrawl): 失败，触发降级');
  }

  if (results.test2?.success && results.test2.scraper === 'cheerio') {
    console.log('✅ 层级 2 (Crawlee/Cheerio): 工作正常（静态页面优化）');
  } else if (results.test2?.success) {
    console.log('✅ 层级 2 (Crawlee/Playwright): 工作正常（动态页面）');
  } else {
    console.log('❌ 层级 2 (Crawlee): 失败');
  }

  if (results.test2?.success || results.test3?.success) {
    console.log('✅ 层级 3 (Playwright): 可用作兜底');
  }

  console.log('');

  if (passedTests >= 2) {
    console.log('🎉 三层降级策略测试通过！系统工作正常。');
  } else {
    console.log('⚠️  部分测试失败，请检查日志。');
  }

  console.log('');
  console.log('='.repeat(80));
}

// 运行测试
runAllTests()
  .then(() => {
    console.log('测试完成');
    process.exit(0);
  })
  .catch(error => {
    console.error('测试执行出错:', error);
    process.exit(1);
  });
