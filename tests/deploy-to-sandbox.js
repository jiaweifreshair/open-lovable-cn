/**
 * 部署生成的代码到 E2B Sandbox 并获取预览 URL
 */

async function deployToSandbox() {
  console.log('🚀 Deploying to E2B Sandbox...\n');

  // 1. 读取生成的代码
  const { readFileSync } = await import('fs');
  const generatedCode = readFileSync('/tmp/deepseek-simple.txt', 'utf-8');
  console.log(`📄 Code size: ${generatedCode.length} bytes`);

  // 2. 创建 Sandbox
  console.log('\n📦 Creating sandbox...');
  const createResponse = await fetch('http://localhost:3000/api/create-ai-sandbox-v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  if (!createResponse.ok) {
    throw new Error(`Create sandbox failed: ${createResponse.status}`);
  }

  const sandboxData = await createResponse.json();
  console.log(`✅ Sandbox created: ${sandboxData.sandboxId}`);
  console.log(`🌐 Preview URL: ${sandboxData.url}`);

  // 3. 应用代码
  console.log('\n⚡ Applying code to sandbox...');
  const applyResponse = await fetch('http://localhost:3000/api/apply-ai-code-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      response: generatedCode,
      isEdit: false,
      packages: [],
      sandboxId: sandboxData.sandboxId,
      allowSandboxCreate: true
    })
  });

  if (!applyResponse.ok) {
    throw new Error(`Apply code failed: ${applyResponse.status}`);
  }

  // 读取 SSE 流
  const reader = applyResponse.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let filesApplied = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });

    // 统计应用的文件
    const matches = text.match(/file_applied/g);
    if (matches && matches.length > filesApplied) {
      filesApplied = matches.length;
      process.stdout.write(`\r   Applied ${filesApplied} files...`);
    }
  }

  console.log(`\n✅ Code applied! ${filesApplied} files`);

  // 4. 等待构建完成
  console.log('\n⏳ Waiting for build (30s)...');
  await new Promise(r => setTimeout(r, 30000));

  // 5. 输出结果
  console.log('\n' + '='.repeat(60));
  console.log('🎉 DEPLOYMENT COMPLETE!');
  console.log('='.repeat(60));
  console.log(`\n🌐 Preview URL: ${sandboxData.url}`);
  console.log(`📦 Sandbox ID: ${sandboxData.sandboxId}`);
  console.log('\n👆 Open this URL in browser to see the result!');

  return {
    sandboxId: sandboxData.sandboxId,
    url: sandboxData.url
  };
}

deployToSandbox().catch(e => {
  console.error('❌ Deployment failed:', e.message);
  process.exit(1);
});
