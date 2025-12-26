/**
 * DeepSeek-R1 简化测试 - 确保完整生成
 */

async function testSimplified() {
  console.log('🚀 Testing DeepSeek-R1 simplified generation...\n');

  const response = await fetch('http://localhost:3000/api/generate-ai-code-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Create a luxury private jet booking landing page with: Header (navigation), Hero (booking form), Services (4 cards), Footer. Use dark theme with gold accents.',
      mode: 'full',
      model: 'gemini-3-pro-preview',
      scrapeIndex: {
        profile: 'Luxury jet charter site. Dark theme (#0F172A), gold accents (#D4AF37). Components: Header, Hero, Services, Footer.',
        chunks: [
          { title: 'Header', body: 'Logo + nav links + Book Now button' },
          { title: 'Hero', body: 'Full-screen hero with booking form' },
          { title: 'Services', body: '4 service cards in grid' },
          { title: 'Footer', body: 'Company info, links, social icons' }
        ]
      }
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

    if (Date.now() - lastUpdate > 3000) {
      process.stdout.write(`\r📥 ${Math.round(text.length / 1024)}KB`);
      lastUpdate = Date.now();
    }
  }

  // 解析 SSE
  let generatedCode = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'stream' && data.text) generatedCode += data.text;
        else if (data.type === 'complete' && data.generatedCode) generatedCode = data.generatedCode;
      } catch {}
    }
  }

  console.log(`\n\n📊 Results:`);
  console.log(`   Response: ${text.length} bytes`);
  console.log(`   Code: ${generatedCode.length} bytes`);

  const files = generatedCode.match(/<file path="[^"]+"/g) || [];
  console.log(`\n📁 Files (${files.length}):`);
  files.forEach(f => console.log(`   ${f.match(/"([^"]+)"/)[1]}`));

  // 检查 App
  const hasApp = /<file path="(?:src\/)?App\.[jt]sx?"/.test(generatedCode);
  console.log(`\n${hasApp ? '✅' : '❌'} App.jsx/tsx: ${hasApp ? 'Found' : 'Missing'}`);

  // 代码质量
  const checks = {
    'Animations': /transition|animation|hover:/,
    'Gradients': /gradient/,
    'Dark Theme': /bg-(?:gray|slate)-[89]00|bg-black/,
    'Gold Accents': /amber|gold|#D4AF37/i,
    'Responsive': /sm:|md:|lg:/,
    'Icons': /lucide|icon/i
  };

  console.log('\n🎨 Quality:');
  let score = 0;
  for (const [name, regex] of Object.entries(checks)) {
    const pass = regex.test(generatedCode);
    console.log(`   ${pass ? '✅' : '❌'} ${name}`);
    if (pass) score += 15;
  }
  if (hasApp) score += 10;

  console.log(`\n📊 Score: ${score}/100`);

  // 保存代码
  const { writeFileSync } = await import('fs');
  writeFileSync('/tmp/deepseek-simple.txt', generatedCode);
  console.log('\n💾 Saved to /tmp/deepseek-simple.txt');

  return { hasApp, score, files: files.length };
}

testSimplified().catch(console.error);
