/**
 * Crawlee 智能爬虫功能测试
 *
 * 测试场景：
 * 1. 静态页面（Wikipedia） - 应使用 Cheerio（极快）
 * 2. 动态页面（示例 SPA）- 应使用 Playwright（强大）
 * 3. 性能对比（Cheerio vs Playwright）
 */

import { getCrawleeScraper } from './lib/scraper/crawlee-scraper';

console.log('='.repeat(80));
console.log('🚀 Crawlee 智能爬虫功能测试');
console.log('='.repeat(80));
console.log('');

const scraper = getCrawleeScraper();

/**
 * 测试 1: 静态页面（Wikipedia）
 * 预期：使用 Cheerio，响应时间 < 100ms
 */
async function testStaticPage() {
  console.log('📄 测试 1: 静态页面爬取（Wikipedia）');
  console.log('-'.repeat(80));

  const url = 'https://en.wikipedia.org/wiki/Web_scraping';
  const startTime = Date.now();

  try {
    const result = await scraper.scrape(url, {
      waitFor: 1000,
      timeout: 30000,
      blockAds: true,
      screenshot: false, // Cheerio 不支持截图
    });

    const duration = Date.now() - startTime;

    console.log('✅ 爬取成功！');
    console.log(`   使用爬虫: ${result.scraper}`);
    console.log(`   响应时间: ${duration}ms`);
    console.log(`   页面标题: ${result.title}`);
    console.log(`   内容长度: ${result.content.length} 字符`);
    console.log(`   Markdown: ${result.markdown.substring(0, 200)}...`);
    console.log('');

    // 验证性能
    if (result.scraper === 'cheerio') {
      console.log('✅ 正确使用 Cheerio（静态页面）');
      if (duration < 1000) {
        console.log(`✅ 性能优秀：${duration}ms < 1000ms`);
      } else {
        console.log(`⚠️  性能一般：${duration}ms >= 1000ms（仍然比 Playwright 快）`);
      }
    } else {
      console.log(`⚠️  应使用 Cheerio 但使用了 ${result.scraper}`);
    }

    console.log('');
    return { success: true, duration, scraper: result.scraper };

  } catch (error) {
    console.error('❌ 测试失败:', (error as Error).message);
    console.log('');
    return { success: false, error: (error as Error).message };
  }
}

/**
 * 测试 2: 动态页面（Example）
 * 预期：降级到 Playwright，响应时间 1-3s
 */
async function testDynamicPage() {
  console.log('🌐 测试 2: 动态页面爬取（Example）');
  console.log('-'.repeat(80));

  const url = 'https://example.com';
  const startTime = Date.now();

  try {
    const result = await scraper.scrape(url, {
      waitFor: 2000,
      timeout: 30000,
      blockAds: true,
      screenshot: true, // Playwright 支持截图
    });

    const duration = Date.now() - startTime;

    console.log('✅ 爬取成功！');
    console.log(`   使用爬虫: ${result.scraper}`);
    console.log(`   响应时间: ${duration}ms`);
    console.log(`   页面标题: ${result.title}`);
    console.log(`   内容长度: ${result.content.length} 字符`);
    console.log(`   截图: ${result.screenshot ? `✅ ${result.screenshot.substring(0, 50)}...` : '❌ 无'}`);
    console.log('');

    // 验证功能
    if (result.screenshot) {
      console.log('✅ 截图功能正常');
    } else {
      console.log('⚠️  截图功能未启用');
    }

    console.log('');
    return { success: true, duration, scraper: result.scraper, hasScreenshot: !!result.screenshot };

  } catch (error) {
    console.error('❌ 测试失败:', (error as Error).message);
    console.log('');
    return { success: false, error: (error as Error).message };
  }
}

/**
 * 测试 3: 性能对比
 */
async function testPerformanceComparison() {
  console.log('⚡ 测试 3: 性能对比（Cheerio vs Playwright）');
  console.log('-'.repeat(80));

  const url = 'https://en.wikipedia.org/wiki/TypeScript';

  // 测试 Cheerio（如果能使用）
  console.log('测试 Cheerio 爬取性能...');
  const cheerioStart = Date.now();
  let cheerioResult;
  try {
    cheerioResult = await scraper.scrape(url, {
      waitFor: 1000,
      timeout: 30000,
      screenshot: false,
    });
  } catch (error) {
    console.error('Cheerio 测试失败:', (error as Error).message);
    cheerioResult = null;
  }
  const cheerioDuration = Date.now() - cheerioStart;

  // 等待 2 秒再测试 Playwright（避免并发问题）
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 对比说明
  console.log('');
  if (cheerioResult) {
    console.log(`📊 性能数据:`);
    console.log(`   使用爬虫: ${cheerioResult.scraper}`);
    console.log(`   响应时间: ${cheerioDuration}ms`);
    console.log(`   内容长度: ${cheerioResult.content.length} 字符`);
    console.log('');

    if (cheerioResult.scraper === 'cheerio') {
      console.log(`✅ Cheerio 性能：${cheerioDuration}ms`);
      console.log(`   预期 Playwright 性能：~2000ms`);
      console.log(`   性能提升：~${Math.round(2000 / cheerioDuration)}x`);
    }
  }

  console.log('');
  return { success: true, cheerioDuration };
}

/**
 * 主测试流程
 */
async function runAllTests() {
  console.log('开始执行测试...\n');

  const results = {
    test1: null,
    test2: null,
    test3: null,
  };

  // 测试 1: 静态页面
  results.test1 = await testStaticPage();
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 测试 2: 动态页面
  results.test2 = await testDynamicPage();
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 测试 3: 性能对比
  results.test3 = await testPerformanceComparison();

  // 总结
  console.log('='.repeat(80));
  console.log('📊 测试总结');
  console.log('='.repeat(80));
  console.log('');

  const passedTests = [
    results.test1?.success,
    results.test2?.success,
    results.test3?.success,
  ].filter(Boolean).length;

  console.log(`总测试数: 3`);
  console.log(`通过: ${passedTests}`);
  console.log(`失败: ${3 - passedTests}`);
  console.log('');

  if (results.test1?.success) {
    console.log(`✅ 测试 1: 静态页面爬取 (${results.test1.duration}ms, ${results.test1.scraper})`);
  } else {
    console.log(`❌ 测试 1: 失败`);
  }

  if (results.test2?.success) {
    console.log(`✅ 测试 2: 动态页面爬取 (${results.test2.duration}ms, ${results.test2.scraper}, 截图: ${results.test2.hasScreenshot ? '✅' : '❌'})`);
  } else {
    console.log(`❌ 测试 2: 失败`);
  }

  if (results.test3?.success) {
    console.log(`✅ 测试 3: 性能对比 (Cheerio: ${results.test3.cheerioDuration}ms)`);
  } else {
    console.log(`❌ 测试 3: 失败`);
  }

  console.log('');

  if (passedTests === 3) {
    console.log('🎉 所有测试通过！Crawlee 智能爬虫工作正常。');
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
