/**
 * 测试克隆 API 的完整性
 * 验证 App.jsx import 的所有组件都被生成
 */

async function testCloneAPI() {
  console.log('Testing clone API with scrapeIndex...\n');

  const response = await fetch('http://localhost:3000/api/generate-ai-code-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Clone jet-bay.com exactly as shown',
      mode: 'full',
      model: 'deepseek-r1',
      scrapeIndex: {
        profile: 'JetBay - Private Jet Charter Booking Platform. Header with logo and navigation, HeroSection with booking form, DestinationsSection showing popular routes, ServicesSection with jet fleet, AppDownloadSection with mobile apps, TestimonialsSection with reviews, FAQSection, Footer with links.',
        chunks: [
          { title: 'Header Component', body: 'Navigation with logo, menu items: Home, Charter, Fleet, About, Contact. Mobile hamburger menu.' },
          { title: 'HeroSection', body: 'Large hero with background image, title "Book Your Private Jet", search form with origin/destination/date inputs.' },
          { title: 'DestinationsSection', body: 'Popular destinations grid: New York, London, Dubai, Paris, Miami. Each with image and price.' },
          { title: 'ServicesSection', body: 'Service cards: Light Jets, Midsize Jets, Heavy Jets, Ultra Long Range. Features and pricing.' },
          { title: 'AppDownloadSection', body: 'Mobile app promotion with App Store and Play Store badges, phone mockup.' },
          { title: 'TestimonialsSection', body: 'Customer reviews carousel with ratings and quotes.' },
          { title: 'FAQSection', body: 'Frequently asked questions accordion.' },
          { title: 'Footer', body: 'Footer with company info, quick links, social media, newsletter signup.' }
        ]
      }
    })
  });

  console.log('Status:', response.status);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });

    // 进度显示
    if (text.length % 10000 < 100) {
      process.stdout.write(`\rReceived: ${Math.round(text.length / 1024)}KB`);
    }

    // 限制大小
    if (text.length > 200000) {
      console.log('\n... (truncated at 200KB)');
      break;
    }
  }

  console.log(`\n\nTotal response length: ${text.length} bytes`);

  // 从 SSE 格式中提取实际代码
  let generatedCode = '';
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'stream' && data.text) {
          generatedCode += data.text;
        } else if (data.type === 'complete' && data.generatedCode) {
          generatedCode = data.generatedCode;
        }
      } catch {}
    }
  }
  console.log(`Extracted code length: ${generatedCode.length} bytes`);

  // 统计文件标签
  const fileTags = generatedCode.match(/<file path="[^"]+"/g) || [];
  console.log(`File tags found: ${fileTags.length}`);
  fileTags.forEach(tag => console.log('  -', tag));

  // 使用提取的代码进行后续检查
  text = generatedCode;

  // 检查 App.jsx imports
  const appMatch = text.match(/<file path="(?:src\/)?App\.jsx">([\s\S]*?)<\/file>/);
  if (appMatch) {
    console.log('\n✓ App.jsx found');

    // 解析 imports
    const importRegex = /import\s+(\w+)\s+from\s+['"]\.\/components\/(\w+)['"]/g;
    const imports = [];
    let match;
    while ((match = importRegex.exec(appMatch[1])) !== null) {
      imports.push(match[2]);
    }
    console.log(`App.jsx imports ${imports.length} components:`, imports.join(', '));

    // 检查每个 import 是否有对应的文件
    const missing = imports.filter(comp => {
      const pattern = `<file path="src/components/${comp}.jsx"`;
      return !text.includes(pattern);
    });

    if (missing.length > 0) {
      console.log('\n❌ MISSING components:', missing.join(', '));
      process.exit(1);
    } else {
      console.log('\n✓ All imported components are generated!');
    }
  } else {
    console.log('❌ App.jsx not found in response');
    process.exit(1);
  }

  // 检查预期的组件
  const expectedComponents = ['Header', 'HeroSection', 'DestinationsSection', 'ServicesSection', 'AppDownloadSection', 'TestimonialsSection', 'FAQSection', 'Footer'];
  const found = expectedComponents.filter(c => text.includes(`${c}.jsx`));
  const notFound = expectedComponents.filter(c => !text.includes(`${c}.jsx`));

  console.log(`\nExpected components found: ${found.length}/${expectedComponents.length}`);
  if (notFound.length > 0) {
    console.log('Not found:', notFound.join(', '));
  }

  console.log('\n✅ Test completed');
}

testCloneAPI().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
