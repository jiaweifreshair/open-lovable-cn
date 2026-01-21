import { NextRequest, NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { sanitizeCode } from '@/lib/code-sanitizer';

/**
 * 批量写入文件到沙箱
 *
 * 请求体格式：
 * {
 *   "sandboxId": "xxx",  // 可选，如果不提供则使用当前活跃的沙箱
 *   "files": [
 *     { "path": "/home/user/app/src/User.java", "content": "..." },
 *     { "path": "/home/user/app/pom.xml", "content": "..." }
 *   ]
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { sandboxId, files } = await request.json();

    if (!files || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Files array is required and must not be empty'
      }, { status: 400 });
    }

    // 获取活跃的沙箱提供者
    const provider = sandboxManager.getActiveProvider();

    if (!provider) {
      return NextResponse.json({
        success: false,
        error: 'No active sandbox. Please create a sandbox first.'
      }, { status: 400 });
    }

    // 验证沙箱ID（如果提供）
    const currentSandboxInfo = provider.getSandboxInfo();
    if (sandboxId && currentSandboxInfo?.sandboxId !== sandboxId) {
      return NextResponse.json({
        success: false,
        error: `Sandbox ID mismatch. Active: ${currentSandboxInfo?.sandboxId}, Requested: ${sandboxId}`
      }, { status: 400 });
    }

    console.log(`[sandbox/write-files] Writing ${files.length} files to sandbox`);

    // 批量写入文件
    const results: { path: string; success: boolean; error?: string }[] = [];

    for (const file of files) {
      if (!file.path || typeof file.content !== 'string') {
        results.push({
          path: file.path || 'unknown',
          success: false,
          error: 'Invalid file format: path and content are required'
        });
        continue;
      }

      try {
        // 清理代码（修复重复导入等问题）
        const sanitizedContent = sanitizeCode(file.content, file.path);
        await provider.writeFile(file.path, sanitizedContent);
        results.push({ path: file.path, success: true });
        console.log(`[sandbox/write-files] Written: ${file.path}`);
      } catch (fileError) {
        results.push({
          path: file.path,
          success: false,
          error: (fileError as Error).message
        });
        console.error(`[sandbox/write-files] Failed to write ${file.path}:`, fileError);
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    return NextResponse.json({
      success: failedCount === 0,
      message: `Written ${successCount}/${files.length} files`,
      results,
      successCount,
      failedCount
    });

  } catch (error) {
    console.error('[sandbox/write-files] Error:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}
