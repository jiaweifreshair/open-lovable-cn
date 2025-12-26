/**
 * DeepSeek-R1 完整生成测试
 * 1. 生成代码
 * 2. 部署到 sandbox
 * 3. 输出预览 URL
 */

async function testDeepSeekR1() {
  console.log('🚀 Testing DeepSeek-R1 full generation...\n');
  console.log('=' .repeat(60));

  // 更详细的 scrapeIndex，模拟真实的 jet-bay.com 克隆
  const scrapeIndex = {
    profile: `JetBay - Premium Private Jet Charter Platform

VISUAL DESIGN:
- Dark luxury theme with gold/amber accents (#D4AF37, #1A1A2E)
- Gradient backgrounds from dark blue to black
- Sleek typography with Inter/Playfair Display fonts
- High-end imagery of private jets and luxury destinations
- Glass morphism effects on cards
- Smooth hover animations and transitions

LAYOUT STRUCTURE:
1. Header: Fixed navigation with logo, menu (Home, Services, Fleet, Destinations, About, Contact), CTA button "Book Now"
2. Hero: Full-screen hero with video/image background, main headline "Experience Luxury in the Sky", booking form with origin/destination/date/passengers
3. Services: Grid of service cards (On-Demand Charter, Empty Leg Flights, Group Charter, Jet Card Membership)
4. Fleet: Showcase different jet categories (Light Jets, Midsize, Super-Midsize, Heavy Jets, Ultra Long Range)
5. Destinations: Popular routes with pricing (NYC-Miami, LA-Vegas, London-Paris, Dubai-Maldives)
6. Testimonials: Customer reviews carousel with ratings
7. App Download: Mobile app promotion section
8. FAQ: Frequently asked questions accordion
9. Footer: Company info, quick links, social media, newsletter signup`,
    chunks: [
      {
        title: 'Header Navigation',
        body: 'Sticky header with transparent to solid transition on scroll. Logo on left (JetBay with plane icon). Navigation links: Home, Services, Fleet, Destinations, About, Contact. Golden "Book Now" CTA button. Mobile hamburger menu with slide-in drawer.'
      },
      {
        title: 'Hero Section',
        body: 'Full viewport hero with parallax jet image background. Overlay gradient. Main headline "Experience Luxury in the Sky" with subtitle "Private jet charter made simple". Booking form card with glass effect: From airport input, To airport input, Date picker, Passengers dropdown, Search button. Trust badges below: "5000+ Flights", "98% Satisfaction", "24/7 Support".'
      },
      {
        title: 'Services Section',
        body: 'Section title "Our Services". 4-column grid of service cards. Each card: icon, title, description, "Learn More" link. Services: 1) On-Demand Charter - Book a private flight anytime, 2) Empty Leg Flights - Discounted one-way flights, 3) Group Charter - For corporate events and groups, 4) Jet Card - Prepaid flight hours with benefits. Cards have hover lift effect.'
      },
      {
        title: 'Fleet Section',
        body: 'Dark section with "Our Fleet" title. Horizontal scrollable or grid of jet categories. Each jet card: image, name, passenger capacity, range, features list, price range per hour. Categories: Light Jets (4-6 pax, $3k-5k/hr), Midsize (6-8 pax, $4k-6k/hr), Super-Midsize (8-10 pax, $5k-8k/hr), Heavy Jets (10-16 pax, $8k-12k/hr).'
      },
      {
        title: 'Destinations Section',
        body: 'Popular routes showcase. "Popular Routes" heading. Grid of destination cards with: route image, origin-destination, flight time, starting price. Routes: NYC to Miami ($15,000), LA to Las Vegas ($8,000), London to Paris ($12,000), Dubai to Maldives ($25,000). Each card has booking CTA.'
      },
      {
        title: 'Testimonials Section',
        body: 'Customer reviews carousel. "What Our Clients Say" heading. Each review: 5-star rating, quote text, customer name, company/title, profile image. Auto-rotating carousel with dots navigation. At least 3 testimonials.'
      },
      {
        title: 'App Download Section',
        body: 'Split section: left side phone mockup showing app UI, right side: "Book Your Flight On The Go" headline, feature bullets (Track flights, Manage bookings, 24/7 support, Exclusive deals), App Store and Google Play download buttons.'
      },
      {
        title: 'FAQ Section',
        body: 'Accordion-style FAQ. "Frequently Asked Questions" heading. Questions: How far in advance should I book?, What is included in charter cost?, Can I bring pets?, What airports do you fly to?, How do empty leg flights work? Each expands to show answer.'
      },
      {
        title: 'Footer',
        body: '4-column footer on dark background. Column 1: Logo, company description, social icons (Instagram, Twitter, LinkedIn, Facebook). Column 2: Quick Links (About, Services, Fleet, Contact). Column 3: Legal (Privacy Policy, Terms, Refund Policy). Column 4: Newsletter signup with email input and subscribe button. Copyright at bottom.'
      }
    ]
  };

  const response = await fetch('http://localhost:3000/api/generate-ai-code-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Clone jet-bay.com - a premium private jet charter booking platform. Create a visually stunning, luxury-themed website with dark mode design, gold accents, glass morphism effects, and smooth animations. Include all sections: Header, Hero with booking form, Services, Fleet showcase, Popular Destinations, Testimonials, App Download, FAQ, and Footer. Make it look expensive and professional.',
      mode: 'full',
      model: 'deepseek-r1',
      scrapeIndex
    })
  });

  console.log('Status:', response.status);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let lastUpdate = Date.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });

    // 进度显示
    if (Date.now() - lastUpdate > 2000) {
      process.stdout.write(`\r📥 Received: ${Math.round(text.length / 1024)}KB`);
      lastUpdate = Date.now();
    }

    if (text.length > 800000) {
      console.log('\n⚠️ Truncated at 800KB');
      break;
    }
  }

  console.log(`\n\n📊 Response Analysis:`);
  console.log('=' .repeat(60));
  console.log(`Total SSE response: ${text.length} bytes`);

  // 解析 SSE 提取代码
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

  console.log(`Extracted code: ${generatedCode.length} bytes`);

  // 文件分析
  const fileTags = generatedCode.match(/<file path="[^"]+"/g) || [];
  console.log(`\n📁 Files generated: ${fileTags.length}`);
  fileTags.forEach(tag => {
    const path = tag.match(/<file path="([^"]+)"/)[1];
    console.log(`   └─ ${path}`);
  });

  // App.jsx 分析
  const appMatch = generatedCode.match(/<file path="(?:src\/)?App\.jsx">([\s\S]*?)<\/file>/);
  if (appMatch) {
    console.log('\n✅ App.jsx found');

    const importRegex = /import\s+(\w+)\s+from\s+['"]\.\/components\/(\w+)['"]/g;
    const imports = [];
    let match;
    while ((match = importRegex.exec(appMatch[1])) !== null) {
      imports.push(match[2]);
    }
    console.log(`   Imports ${imports.length} components: ${imports.join(', ')}`);

    // 检查缺失
    const missing = imports.filter(comp => {
      const pattern = new RegExp(`<file path="src/components/${comp}\\.jsx"`);
      return !pattern.test(generatedCode);
    });

    if (missing.length > 0) {
      console.log(`\n❌ MISSING components: ${missing.join(', ')}`);
    } else {
      console.log(`\n✅ All imported components are generated!`);
    }
  } else {
    console.log('\n❌ App.jsx not found');
  }

  // 保存生成的代码供后续使用
  const { writeFileSync } = await import('fs');
  writeFileSync('/tmp/deepseek-r1-generated.txt', generatedCode);
  console.log('\n💾 Code saved to /tmp/deepseek-r1-generated.txt');

  // 代码质量分析
  console.log('\n📐 Code Quality Analysis:');
  console.log('=' .repeat(60));

  const hasAnimations = /animation|transition|hover:|transform/.test(generatedCode);
  const hasGradients = /gradient|bg-gradient/.test(generatedCode);
  const hasGlassMorphism = /backdrop|blur|glass/.test(generatedCode);
  const hasDarkMode = /dark:|bg-gray-9|bg-slate-9|bg-black|#1/.test(generatedCode);
  const hasResponsive = /sm:|md:|lg:|xl:|2xl:/.test(generatedCode);
  const hasIcons = /lucide|icon|Icon/.test(generatedCode);
  const hasShadows = /shadow-/.test(generatedCode);

  console.log(`   ✓ Animations/Transitions: ${hasAnimations ? '✅' : '❌'}`);
  console.log(`   ✓ Gradients: ${hasGradients ? '✅' : '❌'}`);
  console.log(`   ✓ Glass Morphism: ${hasGlassMorphism ? '✅' : '❌'}`);
  console.log(`   ✓ Dark Theme: ${hasDarkMode ? '✅' : '❌'}`);
  console.log(`   ✓ Responsive Design: ${hasResponsive ? '✅' : '❌'}`);
  console.log(`   ✓ Icons: ${hasIcons ? '✅' : '❌'}`);
  console.log(`   ✓ Shadows: ${hasShadows ? '✅' : '❌'}`);

  // 计算美观度评分
  let beautyScore = 0;
  if (hasAnimations) beautyScore += 15;
  if (hasGradients) beautyScore += 15;
  if (hasGlassMorphism) beautyScore += 15;
  if (hasDarkMode) beautyScore += 10;
  if (hasResponsive) beautyScore += 20;
  if (hasIcons) beautyScore += 10;
  if (hasShadows) beautyScore += 10;
  if (fileTags.length >= 8) beautyScore += 5;

  console.log(`\n🎨 Visual Quality Score: ${beautyScore}/100`);

  console.log('\n' + '=' .repeat(60));
  console.log('🏁 Test completed!');

  return {
    success: true,
    filesCount: fileTags.length,
    beautyScore,
    generatedCode
  };
}

testDeepSeekR1().catch(e => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});
