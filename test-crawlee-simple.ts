/**
 * 简化的 Crawlee 测试脚本
 * 只测试一个简单页面，快速验证功能
 */

import { getCrawleeScraper } from './lib/scraper/crawlee-scraper';

async function testSimple() {
  console.log('🚀 开始简单测试...\n');

  const scraper = getCrawleeScraper();
  const startTime = Date.now();

  try {
    // 测试一个简单的静态页面
    const url = 'https://example.com';
    console.log(`测试 URL: ${url}`);

    const result = await scraper.scrape(url, {
      waitFor: 1000,
      timeout: 15000,
      screenshot: false,
    });

    const duration = Date.now() - startTime;

    console.log('\n✅ 测试成功！');
    console.log(`   爬虫类型: ${result.scraper}`);
    console.log(`   耗时: ${duration}ms`);
    console.log(`   页面标题: ${result.title}`);
    console.log(`   内容长度: ${result.content.length} 字符`);
    console.log(`   Markdown前50字符: ${result.markdown.substring(0, 50)}...`);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ 测试失败:', (error as Error).message);
    console.error((error as Error).stack);
    process.exit(1);
  }
}

testSimple();
