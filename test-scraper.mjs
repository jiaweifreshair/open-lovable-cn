/**
 * 爬虫功能测试脚本
 * 
 * 测试智能路由器的降级逻辑
 */

import { chromium } from 'playwright';

async function testPlaywrightBasic() {
  console.log('\n=== 测试 Playwright 基础功能 ===\n');
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    console.log('1. 访问测试网页...');
    await page.goto('https://example.com', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    console.log('2. 提取页面标题...');
    const title = await page.title();
    console.log('   Title:', title);
    
    console.log('3. 提取页面内容...');
    const content = await page.$eval('body', el => el.textContent || '');
    console.log('   Content length:', content.length);
    
    console.log('4. 截取页面截图...');
    const screenshot = await page.screenshot({
      fullPage: false,
      type: 'png',
    });
    console.log('   Screenshot size:', screenshot.length, 'bytes');
    
    console.log('\n✅ Playwright 基础功能测试通过\n');
    return true;
    
  } catch (error) {
    console.error('\n❌ Playwright 测试失败:', error.message);
    return false;
  } finally {
    await page.close();
    await browser.close();
  }
}

async function main() {
  console.log('Starting scraper tests...\n');
  
  const result = await testPlaywrightBasic();
  
  if (result) {
    console.log('🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('💥 Some tests failed!');
    process.exit(1);
  }
}

main();
