/**
 * Playwright 美观度评测脚本
 * 1. 截图页面
 * 2. 分析视觉元素
 * 3. 输出评测报告
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

async function evaluateBeauty() {
  console.log('🎨 Starting Playwright Beauty Evaluation...\n');
  console.log('='.repeat(60));

  const previewUrl = 'https://5173-i3yqyfko8qdvjk90240vp.e2b.app';

  // 1. 启动浏览器
  console.log('🌐 Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  // 2. 访问页面
  console.log(`📄 Navigating to: ${previewUrl}`);
  try {
    await page.goto(previewUrl, { waitUntil: 'networkidle', timeout: 60000 });
  } catch (e) {
    console.log('⚠️ Page load timeout, continuing anyway...');
  }

  // 等待页面渲染
  await page.waitForTimeout(3000);

  // 3. 截图
  console.log('📸 Taking screenshots...');

  // 全页截图
  await page.screenshot({
    path: '/tmp/jetbay-full.png',
    fullPage: true
  });
  console.log('   ✅ Full page: /tmp/jetbay-full.png');

  // 首屏截图
  await page.screenshot({
    path: '/tmp/jetbay-hero.png',
    fullPage: false
  });
  console.log('   ✅ Hero section: /tmp/jetbay-hero.png');

  // 移动端截图
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: '/tmp/jetbay-mobile.png',
    fullPage: true
  });
  console.log('   ✅ Mobile view: /tmp/jetbay-mobile.png');

  // 恢复桌面视口
  await page.setViewportSize({ width: 1920, height: 1080 });

  // 4. 分析页面元素
  console.log('\n📊 Analyzing page elements...');

  const analysis = await page.evaluate(() => {
    const results = {
      hasContent: document.body.innerText.length > 100,
      hasImages: document.querySelectorAll('img').length,
      hasButtons: document.querySelectorAll('button, a[role="button"], .btn').length,
      hasNavigation: !!document.querySelector('nav, header'),
      hasFooter: !!document.querySelector('footer'),
      hasSections: document.querySelectorAll('section').length,
      hasDarkBackground: false,
      hasAnimations: false,
      hasGradients: false,
      hasIcons: false,
      fontFamilies: new Set(),
      colorPalette: new Set()
    };

    // 检查背景色
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const bgRgb = bodyBg.match(/\d+/g);
    if (bgRgb) {
      const brightness = (parseInt(bgRgb[0]) * 299 + parseInt(bgRgb[1]) * 587 + parseInt(bgRgb[2]) * 114) / 1000;
      results.hasDarkBackground = brightness < 128;
    }

    // 检查样式
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      const style = getComputedStyle(el);

      // 动画
      if (style.transition !== 'all 0s ease 0s' && style.transition !== 'none') {
        results.hasAnimations = true;
      }

      // 渐变
      if (style.backgroundImage.includes('gradient')) {
        results.hasGradients = true;
      }

      // 字体
      if (style.fontFamily) {
        results.fontFamilies.add(style.fontFamily.split(',')[0].trim());
      }

      // 颜色
      if (style.color !== 'rgb(0, 0, 0)') {
        results.colorPalette.add(style.color);
      }
    }

    // 检查 SVG 图标
    results.hasIcons = document.querySelectorAll('svg').length > 0;

    // 转换 Set 为数组
    results.fontFamilies = [...results.fontFamilies].slice(0, 5);
    results.colorPalette = [...results.colorPalette].slice(0, 10);

    return results;
  });

  console.log('\n📋 Analysis Results:');
  console.log(`   Content: ${analysis.hasContent ? '✅' : '❌'}`);
  console.log(`   Navigation: ${analysis.hasNavigation ? '✅' : '❌'}`);
  console.log(`   Footer: ${analysis.hasFooter ? '✅' : '❌'}`);
  console.log(`   Sections: ${analysis.hasSections} found`);
  console.log(`   Buttons: ${analysis.hasButtons} found`);
  console.log(`   SVG Icons: ${analysis.hasIcons ? '✅' : '❌'}`);
  console.log(`   Dark Theme: ${analysis.hasDarkBackground ? '✅' : '❌'}`);
  console.log(`   Animations: ${analysis.hasAnimations ? '✅' : '❌'}`);
  console.log(`   Gradients: ${analysis.hasGradients ? '✅' : '❌'}`);

  // 5. 计算美观度评分
  let beautyScore = 0;
  const scoreBreakdown = [];

  if (analysis.hasContent) { beautyScore += 10; scoreBreakdown.push('Content +10'); }
  if (analysis.hasNavigation) { beautyScore += 10; scoreBreakdown.push('Navigation +10'); }
  if (analysis.hasFooter) { beautyScore += 10; scoreBreakdown.push('Footer +10'); }
  if (analysis.hasSections >= 3) { beautyScore += 15; scoreBreakdown.push('3+ Sections +15'); }
  if (analysis.hasButtons >= 2) { beautyScore += 10; scoreBreakdown.push('Buttons +10'); }
  if (analysis.hasIcons) { beautyScore += 10; scoreBreakdown.push('Icons +10'); }
  if (analysis.hasDarkBackground) { beautyScore += 10; scoreBreakdown.push('Dark Theme +10'); }
  if (analysis.hasAnimations) { beautyScore += 15; scoreBreakdown.push('Animations +15'); }
  if (analysis.hasGradients) { beautyScore += 10; scoreBreakdown.push('Gradients +10'); }

  console.log('\n🎯 Score Breakdown:');
  scoreBreakdown.forEach(s => console.log(`   ${s}`));

  console.log('\n' + '='.repeat(60));
  console.log(`🏆 BEAUTY SCORE: ${beautyScore}/100`);
  console.log('='.repeat(60));

  // 6. 生成报告
  const report = {
    url: previewUrl,
    timestamp: new Date().toISOString(),
    analysis,
    beautyScore,
    scoreBreakdown,
    screenshots: {
      full: '/tmp/jetbay-full.png',
      hero: '/tmp/jetbay-hero.png',
      mobile: '/tmp/jetbay-mobile.png'
    }
  };

  writeFileSync('/tmp/jetbay-beauty-report.json', JSON.stringify(report, null, 2));
  console.log('\n📄 Report saved to: /tmp/jetbay-beauty-report.json');

  // 7. 获取页面 HTML 结构
  const htmlStructure = await page.evaluate(() => {
    const getStructure = (el, depth = 0) => {
      if (depth > 2) return '';
      const tag = el.tagName?.toLowerCase();
      if (!tag || ['script', 'style', 'svg', 'path'].includes(tag)) return '';

      const classes = el.className && typeof el.className === 'string'
        ? `.${el.className.split(' ').slice(0, 2).join('.')}`
        : '';
      const id = el.id ? `#${el.id}` : '';

      let structure = `${'  '.repeat(depth)}<${tag}${id}${classes}>\n`;

      for (const child of el.children) {
        structure += getStructure(child, depth + 1);
      }

      return structure;
    };

    return getStructure(document.body);
  });

  console.log('\n📐 Page Structure (top-level):');
  console.log(htmlStructure.split('\n').slice(0, 20).join('\n'));

  await browser.close();

  return {
    success: true,
    beautyScore,
    analysis
  };
}

evaluateBeauty().catch(e => {
  console.error('❌ Evaluation failed:', e.message);
  process.exit(1);
});
