import { NextResponse } from 'next/server';
import { parseJavaScriptFile, buildComponentTree } from '@/lib/file-parser';
import { FileManifest, FileInfo, RouteInfo } from '@/types/file-manifest';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';

export async function GET() {
  try {
    // 优先使用 V2 Provider（sandboxManager / activeSandboxProvider），再回退到 legacy activeSandbox
    const provider = sandboxManager.getActiveProvider() || global.activeSandboxProvider;
    const legacySandbox = global.activeSandbox;

    if (!provider && !legacySandbox) {
      return NextResponse.json({
        success: false,
        error: 'No active sandbox'
      }, { status: 404 });
    }

    console.log('[get-sandbox-files] Fetching and analyzing file structure...');
    
    const filesContent: Record<string, string> = {};

    // 统一限定：只分析这些类型（避免读取大体积 lock/二进制）
    const allowedExtensions = new Set(['.jsx', '.js', '.tsx', '.ts', '.css', '.json']);
    const skipFileNames = new Set([
      'package-lock.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'bun.lock',
      'npm-debug.log',
    ]);

    let fileList: string[] = [];

    if (provider && typeof provider.listFiles === 'function' && typeof provider.readFile === 'function') {
      // ✅ Provider 路径：跨 E2B/Vercel 一致，避免 legacy `stat -f` 兼容问题
      const allFiles: string[] = await provider.listFiles();
      fileList = allFiles.filter((p) => {
        const base = p.split('/').pop() || p;
        if (skipFileNames.has(base)) return false;
        const ext = base.includes('.') ? `.${base.split('.').pop()}` : '';
        return allowedExtensions.has(ext);
      });

      console.log('[get-sandbox-files] Found', fileList.length, 'files (provider)');

      for (const relativePath of fileList) {
        try {
          const base = relativePath.split('/').pop() || relativePath;
          if (skipFileNames.has(base)) continue;

          const content = await provider.readFile(relativePath);
          // Only keep files smaller than 10KB (rough heuristic by characters)
          if (content && content.length < 10000) {
            filesContent[relativePath] = content;
          }
        } catch (parseError) {
          console.debug('Error reading file:', relativePath, parseError);
          continue;
        }
      }
    } else if (legacySandbox && typeof legacySandbox.runCommand === 'function') {
      // Legacy sandbox: 兼容旧 Vercel SDK runCommand({cmd,args}) 形态
      const findResult = await legacySandbox.runCommand({
        cmd: 'find',
        args: [
          '.',
          '-name', 'node_modules', '-prune', '-o',
          '-name', '.git', '-prune', '-o',
          '-name', 'dist', '-prune', '-o',
          '-name', 'build', '-prune', '-o',
          '-type', 'f',
          '(',
          '-name', '*.jsx',
          '-o', '-name', '*.js',
          '-o', '-name', '*.tsx',
          '-o', '-name', '*.ts',
          '-o', '-name', '*.css',
          '-o', '-name', '*.json',
          ')',
          '-print'
        ]
      });

      if (findResult.exitCode !== 0) {
        throw new Error('Failed to list files');
      }

      const findStdout = typeof findResult.stdout === 'function' ? await findResult.stdout() : (findResult.stdout || '');
      fileList = findStdout.split('\n').filter((f: string) => f.trim());
      console.log('[get-sandbox-files] Found', fileList.length, 'files (legacy)');

      for (const filePath of fileList) {
        try {
          const relativePath = filePath.replace(/^\.\//, '');
          const base = relativePath.split('/').pop() || relativePath;
          if (skipFileNames.has(base)) continue;

          // Check file size first (portable): wc -c
          const wcResult = await legacySandbox.runCommand({
            cmd: 'wc',
            args: ['-c', filePath]
          });
          if (wcResult.exitCode !== 0) continue;

          const wcStdout = typeof wcResult.stdout === 'function' ? await wcResult.stdout() : (wcResult.stdout || '');
          const fileSize = parseInt(wcStdout.trim().split(/\s+/)[0], 10);
          if (!Number.isFinite(fileSize) || fileSize >= 10000) continue;

          const catResult = await legacySandbox.runCommand({
            cmd: 'cat',
            args: [filePath]
          });
          if (catResult.exitCode !== 0) continue;

          const content = typeof catResult.stdout === 'function' ? await catResult.stdout() : (catResult.stdout || '');
          filesContent[relativePath] = content;
        } catch (parseError) {
          console.debug('Error reading file:', filePath, parseError);
          continue;
        }
      }
    }

    // 目录结构：用文件路径推导，避免额外 `find -type d`（兼容性更好）
    const dirSet = new Set<string>(['.']);
    for (const pathEntry of fileList) {
      const rel = pathEntry.replace(/^\.\//, '');
      const parts = rel.split('/');
      if (parts.length <= 1) continue;
      let acc = '.';
      for (let i = 0; i < parts.length - 1; i += 1) {
        acc = `${acc}/${parts[i]}`;
        dirSet.add(acc);
      }
    }
    const structure = Array.from(dirSet).sort().slice(0, 50).join('\n');
    
    // Build enhanced file manifest
    const fileManifest: FileManifest = {
      files: {},
      routes: [],
      componentTree: {},
      entryPoint: '',
      styleFiles: [],
      timestamp: Date.now(),
    };
    
    // Process each file
    for (const [relativePath, content] of Object.entries(filesContent)) {
      const fullPath = `/${relativePath}`;
      
      // Create base file info
      const fileInfo: FileInfo = {
        content: content,
        type: 'utility',
        path: fullPath,
        relativePath,
        lastModified: Date.now(),
      };
      
      // Parse JavaScript/JSX files
      if (relativePath.match(/\.(jsx?|tsx?)$/)) {
        const parseResult = parseJavaScriptFile(content, fullPath);
        Object.assign(fileInfo, parseResult);
        
        // Identify entry point
        if (relativePath === 'src/main.jsx' || relativePath === 'src/index.jsx') {
          fileManifest.entryPoint = fullPath;
        }
        
        // Identify App.jsx
        if (relativePath === 'src/App.jsx' || relativePath === 'App.jsx') {
          fileManifest.entryPoint = fileManifest.entryPoint || fullPath;
        }
      }
      
      // Track style files
      if (relativePath.endsWith('.css')) {
        fileManifest.styleFiles.push(fullPath);
      fileInfo.type = 'style';
      }
      
      fileManifest.files[fullPath] = fileInfo;
    }
    
    // Build component tree
    fileManifest.componentTree = buildComponentTree(fileManifest.files);
    
    // Extract routes (simplified - looks for Route components or page pattern)
    fileManifest.routes = extractRoutes(fileManifest.files);
    
    // Update global file cache with manifest
    if (global.sandboxState?.fileCache) {
      global.sandboxState.fileCache.manifest = fileManifest;
    }

    return NextResponse.json({
      success: true,
      files: filesContent,
      structure,
      fileCount: Object.keys(filesContent).length,
      manifest: fileManifest,
    });

  } catch (error) {
    console.error('[get-sandbox-files] Error:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}

function extractRoutes(files: Record<string, FileInfo>): RouteInfo[] {
  const routes: RouteInfo[] = [];
  
  // Look for React Router usage
  for (const [path, fileInfo] of Object.entries(files)) {
    if (fileInfo.content.includes('<Route') || fileInfo.content.includes('createBrowserRouter')) {
      // Extract route definitions (simplified)
      const routeMatches = fileInfo.content.matchAll(/path=["']([^"']+)["'].*(?:element|component)={([^}]+)}/g);
      
      for (const match of routeMatches) {
        const [, routePath] = match;
        // componentRef available in match but not used currently
        routes.push({
          path: routePath,
          component: path,
        });
      }
    }
    
    // Check for Next.js style pages
    if (fileInfo.relativePath.startsWith('pages/') || fileInfo.relativePath.startsWith('src/pages/')) {
      const routePath = '/' + fileInfo.relativePath
        .replace(/^(src\/)?pages\//, '')
        .replace(/\.(jsx?|tsx?)$/, '')
        .replace(/index$/, '');
        
      routes.push({
        path: routePath,
        component: path,
      });
    }
  }
  
  return routes;
}
