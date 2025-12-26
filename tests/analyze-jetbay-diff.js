/**
 * JETBAY 网站差异分析脚本
 * 对比原网站和克隆版本的视觉和结构差异
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function analyzeWebsite(url, name) {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  console.log(`\n🔍 分析 ${name}: ${url}`);

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000); // 等待动画完成

  const analysis = {
    name,
    url,
    timestamp: new Date().toISOString(),

    // 1. 整体布局分析
    layout: {
      viewport: await page.viewportSize(),
      bodyBackground: await page.evaluate(() => {
        return window.getComputedStyle(document.body).backgroundColor;
      }),
      bodyColor: await page.evaluate(() => {
        return window.getComputedStyle(document.body).color;
      })
    },

    // 2. Hero区域分析
    hero: await page.evaluate(() => {
      const hero = document.querySelector('[class*="hero"], section:first-of-type, .banner');
      if (!hero) return null;

      const styles = window.getComputedStyle(hero);
      return {
        backgroundColor: styles.backgroundColor,
        backgroundImage: styles.backgroundImage,
        height: styles.height,
        padding: styles.padding,
        hasBackgroundImage: styles.backgroundImage !== 'none'
      };
    }),

    // 3. 主标题分析
    mainTitle: await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (!h1) return null;

      const styles = window.getComputedStyle(h1);
      return {
        text: h1.textContent.trim(),
        fontSize: styles.fontSize,
        fontWeight: styles.fontWeight,
        color: styles.color,
        fontFamily: styles.fontFamily,
        textAlign: styles.textAlign
      };
    }),

    // 4. 导航栏分析
    navigation: await page.evaluate(() => {
      const nav = document.querySelector('nav, header nav, [role="navigation"]');
      if (!nav) return null;

      const styles = window.getComputedStyle(nav);
      const links = Array.from(nav.querySelectorAll('a')).map(a => a.textContent.trim());

      return {
        backgroundColor: styles.backgroundColor,
        height: styles.height,
        position: styles.position,
        links: links.slice(0, 10), // 前10个链接
        linkCount: links.length
      };
    }),

    // 5. 预订表单分析
    bookingForm: await page.evaluate(() => {
      const form = document.querySelector('form, [class*="booking"], [class*="search"]');
      if (!form) return null;

      const styles = window.getComputedStyle(form);
      const inputs = form.querySelectorAll('input, select, button');

      return {
        backgroundColor: styles.backgroundColor,
        padding: styles.padding,
        borderRadius: styles.borderRadius,
        boxShadow: styles.boxShadow,
        inputCount: inputs.length,
        formElements: Array.from(inputs).map(el => ({
          type: el.tagName.toLowerCase(),
          placeholder: el.placeholder || el.textContent?.trim() || ''
        })).slice(0, 10)
      };
    }),

    // 6. 颜色方案分析
    colorScheme: await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      const colors = new Set();
      const backgrounds = new Set();

      Array.from(allElements).slice(0, 100).forEach(el => {
        const styles = window.getComputedStyle(el);
        colors.add(styles.color);
        backgrounds.add(styles.backgroundColor);
      });

      return {
        uniqueTextColors: Array.from(colors).slice(0, 20),
        uniqueBackgrounds: Array.from(backgrounds).slice(0, 20)
      };
    }),

    // 7. 字体分析
    fonts: await page.evaluate(() => {
      const elements = document.querySelectorAll('h1, h2, h3, p, a, button');
      const fonts = new Set();

      Array.from(elements).slice(0, 50).forEach(el => {
        const styles = window.getComputedStyle(el);
        fonts.add(styles.fontFamily);
      });

      return Array.from(fonts);
    }),

    // 8. 图片分析
    images: await page.evaluate(() => {
      const images = document.querySelectorAll('img');
      return Array.from(images).slice(0, 10).map(img => ({
        src: img.src,
        alt: img.alt,
        width: img.width,
        height: img.height,
        loading: img.loading
      }));
    }),

    // 9. 关键元素存在性检查
    keyElements: await page.evaluate(() => {
      return {
        hasH1: !!document.querySelector('h1'),
        hasNav: !!document.querySelector('nav'),
        hasForm: !!document.querySelector('form'),
        hasHero: !!document.querySelector('[class*="hero"]'),
        hasFooter: !!document.querySelector('footer'),

        // 特定文本检查
        hasPrivateJetText: document.body.textContent.includes('Private Jet'),
        hasAccessText: document.body.textContent.includes('Access 10,000'),
        hasJETBAYText: document.body.textContent.includes('JETBAY')
      };
    })
  };

  // 截图保存
  const screenshotDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const screenshotPath = path.join(screenshotDir, `${name}-${Date.now()}.png`);
  await page.screenshot({
    path: screenshotPath,
    fullPage: true
  });

  console.log(`📸 截图已保存: ${screenshotPath}`);

  await browser.close();

  return analysis;
}

function compareAnalysis(original, clone) {
  console.log('\n📊 ===== 差异分析报告 =====\n');

  // 1. 整体布局差异
  console.log('1️⃣ 整体布局差异：');
  console.log(`   原网站背景色: ${original.layout.bodyBackground}`);
  console.log(`   克隆版背景色: ${clone.layout.bodyBackground}`);
  console.log(`   背景色匹配: ${original.layout.bodyBackground === clone.layout.bodyBackground ? '✅' : '❌'}`);
  console.log('');

  // 2. Hero区域差异
  console.log('2️⃣ Hero区域差异：');
  if (original.hero && clone.hero) {
    console.log(`   原网站背景: ${original.hero.backgroundImage.substring(0, 100)}...`);
    console.log(`   克隆版背景: ${clone.hero.backgroundImage.substring(0, 100)}...`);
    console.log(`   原网站高度: ${original.hero.height}`);
    console.log(`   克隆版高度: ${clone.hero.height}`);
    console.log(`   背景图片存在: 原版${original.hero.hasBackgroundImage ? '✅' : '❌'} vs 克隆${clone.hero.hasBackgroundImage ? '✅' : '❌'}`);
  } else {
    console.log(`   ⚠️ Hero区域未找到`);
  }
  console.log('');

  // 3. 主标题差异
  console.log('3️⃣ 主标题差异：');
  if (original.mainTitle && clone.mainTitle) {
    console.log(`   原网站: "${original.mainTitle.text}"`);
    console.log(`   克隆版: "${clone.mainTitle.text}"`);
    console.log(`   文字匹配: ${original.mainTitle.text === clone.mainTitle.text ? '✅' : '❌'}`);
    console.log(`   原网站字体: ${original.mainTitle.fontSize} / ${original.mainTitle.fontWeight}`);
    console.log(`   克隆版字体: ${clone.mainTitle.fontSize} / ${clone.mainTitle.fontWeight}`);
    console.log(`   原网站颜色: ${original.mainTitle.color}`);
    console.log(`   克隆版颜色: ${clone.mainTitle.color}`);
  }
  console.log('');

  // 4. 导航栏差异
  console.log('4️⃣ 导航栏差异：');
  if (original.navigation && clone.navigation) {
    console.log(`   原网站链接数: ${original.navigation.linkCount}`);
    console.log(`   克隆版链接数: ${clone.navigation.linkCount}`);
    console.log(`   原网站背景: ${original.navigation.backgroundColor}`);
    console.log(`   克隆版背景: ${clone.navigation.backgroundColor}`);
  }
  console.log('');

  // 5. 预订表单差异
  console.log('5️⃣ 预订表单差异：');
  if (original.bookingForm && clone.bookingForm) {
    console.log(`   原网站表单背景: ${original.bookingForm.backgroundColor}`);
    console.log(`   克隆版表单背景: ${clone.bookingForm.backgroundColor}`);
    console.log(`   原网站输入元素: ${original.bookingForm.inputCount}个`);
    console.log(`   克隆版输入元素: ${clone.bookingForm.inputCount}个`);
    console.log(`   圆角: 原版${original.bookingForm.borderRadius} vs 克隆${clone.bookingForm.borderRadius}`);
  }
  console.log('');

  // 6. 关键元素检查
  console.log('6️⃣ 关键元素存在性：');
  console.log(`   H1标题:       原版${original.keyElements.hasH1 ? '✅' : '❌'} vs 克隆${clone.keyElements.hasH1 ? '✅' : '❌'}`);
  console.log(`   导航栏:       原版${original.keyElements.hasNav ? '✅' : '❌'} vs 克隆${clone.keyElements.hasNav ? '✅' : '❌'}`);
  console.log(`   表单:         原版${original.keyElements.hasForm ? '✅' : '❌'} vs 克隆${clone.keyElements.hasForm ? '✅' : '❌'}`);
  console.log(`   Hero区域:     原版${original.keyElements.hasHero ? '✅' : '❌'} vs 克隆${clone.keyElements.hasHero ? '✅' : '❌'}`);
  console.log(`   特定文本检查:`);
  console.log(`     "Private Jet": 原版${original.keyElements.hasPrivateJetText ? '✅' : '❌'} vs 克隆${clone.keyElements.hasPrivateJetText ? '✅' : '❌'}`);
  console.log(`     "Access 10,000": 原版${original.keyElements.hasAccessText ? '✅' : '❌'} vs 克隆${clone.keyElements.hasAccessText ? '✅' : '❌'}`);
  console.log('');

  // 7. 总结关键差异
  console.log('7️⃣ 关键差异总结：');
  const issues = [];

  if (original.layout.bodyBackground !== clone.layout.bodyBackground) {
    issues.push('❌ 整体背景色不匹配');
  }

  if (original.mainTitle && clone.mainTitle && original.mainTitle.text !== clone.mainTitle.text) {
    issues.push('❌ 主标题文字不匹配');
  }

  if (original.hero?.hasBackgroundImage !== clone.hero?.hasBackgroundImage) {
    issues.push('❌ Hero背景图片缺失或不匹配');
  }

  if (!clone.keyElements.hasForm) {
    issues.push('❌ 预订表单缺失');
  }

  if (issues.length === 0) {
    console.log('   ✅ 未发现重大差异');
  } else {
    issues.forEach(issue => console.log(`   ${issue}`));
  }

  console.log('\n' + '='.repeat(50) + '\n');

  return issues;
}

async function main() {
  const originalUrl = 'https://www.jet-bay.com';

  // 从环境变量或参数获取克隆版本的URL
  const cloneUrl = process.env.CLONE_URL || process.argv[2] || 'http://localhost:5173';

  console.log('🚀 开始分析 JETBAY 网站差异...');
  console.log(`原网站: ${originalUrl}`);
  console.log(`克隆版: ${cloneUrl}`);

  try {
    // 分析原网站
    const originalAnalysis = await analyzeWebsite(originalUrl, 'original');

    // 分析克隆版本
    const cloneAnalysis = await analyzeWebsite(cloneUrl, 'clone');

    // 保存分析结果
    const resultsDir = path.join(__dirname, 'analysis-results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const resultsPath = path.join(resultsDir, `jetbay-analysis-${Date.now()}.json`);
    fs.writeFileSync(resultsPath, JSON.stringify({
      original: originalAnalysis,
      clone: cloneAnalysis,
      timestamp: new Date().toISOString()
    }, null, 2));

    console.log(`\n💾 完整分析结果已保存: ${resultsPath}`);

    // 对比分析
    const issues = compareAnalysis(originalAnalysis, cloneAnalysis);

    console.log('\n📝 后续建议：');
    if (issues.length > 0) {
      console.log('需要修复以下问题以提高相似度：');
      issues.forEach((issue, index) => {
        console.log(`${index + 1}. ${issue.replace('❌ ', '')}`);
      });
    } else {
      console.log('✅ 克隆版本与原网站高度相似，无需重大调整');
    }

  } catch (error) {
    console.error('❌ 分析过程出错:', error);
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { analyzeWebsite, compareAnalysis };
