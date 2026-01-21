import { Sandbox } from '@e2b/code-interpreter';
import { SandboxProvider, SandboxInfo, CommandResult } from '../types';
// SandboxProviderConfig available through parent class
import { appConfig } from '@/config/app.config';
import { TAILWIND_CONFIG, INDEX_CSS, UTILS_JS, getViteConfig } from './e2b-sandbox-setup';

export class E2BProvider extends SandboxProvider {
  private existingFiles: Set<string> = new Set();

  /**
   * Attempt to reconnect to an existing E2B sandbox
   */
  async reconnect(sandboxId: string): Promise<boolean> {
    try {
      
      // Try to connect to existing sandbox
      // Note: E2B SDK doesn't directly support reconnection, but we can try to recreate
      // For now, return false to indicate reconnection isn't supported
      // In the future, E2B may add this capability
      
      return false;
    } catch (error) {
      console.error(`[E2BProvider] Failed to reconnect to sandbox ${sandboxId}:`, error);
      return false;
    }
  }

  async createSandbox(): Promise<SandboxInfo> {
    try {
      
      // Kill existing sandbox if any
      if (this.sandbox) {
        try {
          await this.sandbox.kill();
        } catch (e) {
          console.error('Failed to close existing sandbox:', e);
        }
        this.sandbox = null;
      }
      
      // Clear existing files tracking
      this.existingFiles.clear();

      // Create base sandbox
      this.sandbox = await Sandbox.create({ 
        apiKey: this.config.e2b?.apiKey || process.env.E2B_API_KEY,
        timeoutMs: this.config.e2b?.timeoutMs || appConfig.e2b.timeoutMs
      });
      
      const sandboxId = (this.sandbox as any).sandboxId || Date.now().toString();
      const host = (this.sandbox as any).getHost(appConfig.e2b.vitePort);
      

      this.sandboxInfo = {
        sandboxId,
        url: `https://${host}`,
        provider: 'e2b',
        createdAt: new Date()
      };

      // Set extended timeout on the sandbox instance if method available
      if (typeof this.sandbox.setTimeout === 'function') {
        this.sandbox.setTimeout(appConfig.e2b.timeoutMs);
      }

      return this.sandboxInfo;

    } catch (error) {
      console.error('[E2BProvider] Error creating sandbox:', error);
      throw error;
    }
  }

  async runCommand(command: string): Promise<CommandResult> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    console.log(`[E2BProvider] Running command: ${command}`);

    // 使用shell=True来正确处理复杂命令（包含&&、2>&1等shell语法）
    // 不再使用command.split(' ')，因为这会错误拆分复杂命令
    const result = await this.sandbox.runCode(`
import subprocess
import os
import sys

# 设置工作目录
os.chdir('/home/user/app')

# 使用shell=True执行命令，支持shell语法（&&、|、2>&1等）
process = subprocess.run(
    ${JSON.stringify(command)},
    capture_output=True,
    text=True,
    shell=True,
    cwd='/home/user/app'
)

# 输出结果，使用特殊标记便于解析
print("===STDOUT_START===")
print(process.stdout)
print("===STDOUT_END===")
print("===STDERR_START===")
print(process.stderr)
print("===STDERR_END===")
print(f"===EXIT_CODE==={process.returncode}")
    `);

    // 解析输出
    const rawOutput = result.logs.stdout.join('\n');
    const rawStderr = result.logs.stderr.join('\n');

    // 从标记中提取stdout
    const stdoutMatch = rawOutput.match(/===STDOUT_START===\n?([\s\S]*?)===STDOUT_END===/);
    const stdout = stdoutMatch ? stdoutMatch[1].trim() : rawOutput;

    // 从标记中提取stderr
    const stderrMatch = rawOutput.match(/===STDERR_START===\n?([\s\S]*?)===STDERR_END===/);
    const stderr = stderrMatch ? stderrMatch[1].trim() : rawStderr;

    // 从标记中提取exitCode
    const exitCodeMatch = rawOutput.match(/===EXIT_CODE===(\d+)/);
    const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : (result.error ? 1 : 0);

    console.log(`[E2BProvider] Command completed with exitCode: ${exitCode}`);

    return {
      stdout,
      stderr,
      exitCode,
      success: exitCode === 0
    };
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    const fullPath = path.startsWith('/') ? path : `/home/user/app/${path}`;
    
    // Use the E2B filesystem API to write the file
    // Note: E2B SDK uses files.write() method
    if ((this.sandbox as any).files && typeof (this.sandbox as any).files.write === 'function') {
      // Use the files.write API if available
      await (this.sandbox as any).files.write(fullPath, Buffer.from(content));
    } else {
      // Fallback to Python code execution
      await this.sandbox.runCode(`
        import os

        # Ensure directory exists
        dir_path = os.path.dirname("${fullPath}")
        os.makedirs(dir_path, exist_ok=True)

        # Write file
        with open("${fullPath}", 'w') as f:
            f.write(${JSON.stringify(content)})
        print(f"✓ Written: ${fullPath}")
      `);
    }
    
    this.existingFiles.add(path);
  }

  async readFile(path: string): Promise<string> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    const fullPath = path.startsWith('/') ? path : `/home/user/app/${path}`;
    
    const result = await this.sandbox.runCode(`
      with open("${fullPath}", 'r') as f:
          content = f.read()
      print(content)
    `);
    
    return result.logs.stdout.join('\n');
  }

  async listFiles(directory: string = '/home/user/app'): Promise<string[]> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    const result = await this.sandbox.runCode(`
      import os
      import json

      def list_files(path):
          files = []
          for root, dirs, filenames in os.walk(path):
              # Skip node_modules and .git
              dirs[:] = [d for d in dirs if d not in ['node_modules', '.git', '.next', 'dist', 'build']]
              for filename in filenames:
                  rel_path = os.path.relpath(os.path.join(root, filename), path)
                  files.append(rel_path)
          return files

      files = list_files("${directory}")
      print(json.dumps(files))
    `);
    
    try {
      return JSON.parse(result.logs.stdout.join(''));
    } catch {
      return [];
    }
  }

  async installPackages(packages: string[]): Promise<CommandResult> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    const packageList = packages.join(' ');
    const flags = appConfig.packages.useLegacyPeerDeps ? '--legacy-peer-deps' : '';
    
    
    const result = await this.sandbox.runCode(`
      import subprocess
      import os

      os.chdir('/home/user/app')

      # Install packages
      result = subprocess.run(
          ['npm', 'install', ${flags ? `'${flags}',` : ''} ${packages.map(p => `'${p}'`).join(', ')}],
          capture_output=True,
          text=True
      )

      print("STDOUT:")
      print(result.stdout)
      if result.stderr:
          print("\\nSTDERR:")
          print(result.stderr)
      print(f"\\nReturn code: {result.returncode}")
    `);
    
    const output = result.logs.stdout.join('\n');
    const stderr = result.logs.stderr.join('\n');
    
    // Restart Vite if configured
    if (appConfig.packages.autoRestartVite && !result.error) {
      await this.restartViteServer();
    }
    
    return {
      stdout: output,
      stderr,
      exitCode: result.error ? 1 : 0,
      success: !result.error
    };
  }

  async setupViteApp(): Promise<void> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    // Helper function to execute code with retry
    const runCodeWithRetry = async (code: string, maxRetries = 3, delayMs = 2000) => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          return await this.sandbox.runCode(code);
        } catch (error: any) {
          const isNetworkError = error.message?.includes('fetch failed') ||
                                 error.message?.includes('ECONNRESET') ||
                                 error.code === 'ECONNRESET';

          if (isNetworkError && attempt < maxRetries) {
            console.log(`[E2BProvider] Network error on attempt ${attempt}/${maxRetries}, retrying in ${delayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }
          throw error;
        }
      }
    };


    const viteConfig = getViteConfig(appConfig.e2b.vitePort);

    // Write all files in a single Python script
    const setupScript = `
import os
import json

print('Setting up React app with Vite and Tailwind...')

# Create directory structure
os.makedirs('/home/user/app/src', exist_ok=True)
os.makedirs('/home/user/app/src/lib', exist_ok=True)

# lib/utils.js
utils_js = """${UTILS_JS}"""

with open('/home/user/app/src/lib/utils.js', 'w') as f:
    f.write(utils_js)
print('✓ src/lib/utils.js')

# Package.json
package_json = {
    "name": "sandbox-app",
    "version": "1.0.0",
    "type": "module",
    "scripts": {
        "dev": "vite --host",
        "build": "vite build",
        "preview": "vite preview"
    },
    "dependencies": {
        "react": "^18.2.0",
        "react-dom": "^18.2.0",
        "clsx": "^2.0.0",
        "tailwind-merge": "^2.0.0",
        "lucide-react": "^0.292.0"
    },
    "devDependencies": {
        "@vitejs/plugin-react": "^4.0.0",
        "vite": "^4.3.9",
        "tailwindcss": "^3.3.0",
        "postcss": "^8.4.31",
        "autoprefixer": "^10.4.16",
        "@tailwindcss/typography": "^0.5.16"
    }
}

with open('/home/user/app/package.json', 'w') as f:
    json.dump(package_json, f, indent=2)
print('✓ package.json')

# Vite config
vite_config = """${viteConfig}"""

with open('/home/user/app/vite.config.js', 'w') as f:
    f.write(vite_config)
print('✓ vite.config.js')

# Tailwind config
tailwind_config = """${TAILWIND_CONFIG}"""

with open('/home/user/app/tailwind.config.js', 'w') as f:
    f.write(tailwind_config)
print('✓ tailwind.config.js')

# PostCSS config
postcss_config = """export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}"""

with open('/home/user/app/postcss.config.js', 'w') as f:
    f.write(postcss_config)
print('✓ postcss.config.js')

# Index.html
index_html = """<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sandbox App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>"""

with open('/home/user/app/index.html', 'w') as f:
    f.write(index_html)
print('✓ index.html')

# Main.jsx
main_jsx = """import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)"""

with open('/home/user/app/src/main.jsx', 'w') as f:
    f.write(main_jsx)
print('✓ src/main.jsx')

# App.jsx
app_jsx = """function App() {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
      <div className="text-center max-w-2xl">
        <p className="text-lg text-gray-400">
          Sandbox Ready<br/>
          Start building your React app with Vite and Tailwind CSS!
        </p>
      </div>
    </div>
  )
}

export default App"""

with open('/home/user/app/src/App.jsx', 'w') as f:
    f.write(app_jsx)
print('✓ src/App.jsx')

# Index.css
index_css = """${INDEX_CSS}"""

with open('/home/user/app/src/index.css', 'w') as f:
    f.write(index_css)
print('✓ src/index.css')

print('\\nAll files created successfully!')
`;

    await runCodeWithRetry(setupScript);

    // Install dependencies
    await runCodeWithRetry(`
import subprocess

print('Installing npm packages...')
result = subprocess.run(
    ['npm', 'install'],
    cwd='/home/user/app',
    capture_output=True,
    text=True
)

if result.returncode == 0:
    print('✓ Dependencies installed successfully')
else:
    print(f'⚠ Warning: npm install had issues: {result.stderr}')
    `);

    // Start Vite dev server
    await runCodeWithRetry(`
import subprocess
import os
import time
import socket

os.chdir('/home/user/app')

# Kill any existing Vite processes
subprocess.run(['pkill', '-f', 'vite'], capture_output=True)
time.sleep(1)

# Start Vite dev server
env = os.environ.copy()
env['FORCE_COLOR'] = '0'

process = subprocess.Popen(
    ['npm', 'run', 'dev'],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    env=env
)

print(f'✓ Vite dev server started with PID: {process.pid}')
print('Waiting for server to be ready...')

# Check port availability
def is_port_open(port, timeout=60):
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            result = sock.connect_ex(('127.0.0.1', port))
            sock.close()
            if result == 0:
                return True
        except:
            pass
        time.sleep(2)
    return False

if is_port_open(${appConfig.e2b.vitePort}):
    print(f'✓ Vite server is ready on port ${appConfig.e2b.vitePort}')
else:
    print(f'⚠ Warning: Port ${appConfig.e2b.vitePort} not available after 60s')
    `);
    
    // Track initial files
    this.existingFiles.add('src/App.jsx');
    this.existingFiles.add('src/main.jsx');
    this.existingFiles.add('src/index.css');
    this.existingFiles.add('index.html');
    this.existingFiles.add('package.json');
    this.existingFiles.add('vite.config.js');
    this.existingFiles.add('tailwind.config.js');
    this.existingFiles.add('postcss.config.js');
  }

  /**
   * 设置Maven/JDK开发环境
   * 用于G3引擎的Java代码编译
   *
   * 安装内容：
   * - OpenJDK 17
   * - Maven 3.9.x
   *
   * @returns Promise<void>
   */
  async setupMavenEnvironment(): Promise<void> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    console.log('[E2BProvider] Setting up Maven/JDK environment...');

    // Helper function to execute code with retry
    const runCodeWithRetry = async (code: string, maxRetries = 3, delayMs = 2000) => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          return await this.sandbox!.runCode(code);
        } catch (error: any) {
          const isNetworkError = error.message?.includes('fetch failed') ||
                                 error.message?.includes('ECONNRESET') ||
                                 error.code === 'ECONNRESET';

          if (isNetworkError && attempt < maxRetries) {
            console.log(`[E2BProvider] Network error on attempt ${attempt}/${maxRetries}, retrying in ${delayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }
          throw error;
        }
      }
    };

    // 使用SDKMAN安装JDK和Maven（更可靠的跨平台方式）
    const installScript = `
import subprocess
import os
import sys

print('=== 开始安装Maven/JDK环境 ===')

# 安装依赖
print('正在安装依赖 (curl, unzip)...')
result = subprocess.run(
    ['apt-get', 'update'],
    capture_output=True,
    text=True
)
result = subprocess.run(
    ['apt-get', 'install', '-y', 'curl', 'unzip', 'zip'],
    capture_output=True,
    text=True
)
if result.returncode != 0:
    print(f'安装依赖警告: {result.stderr}')

print('✓ 依赖安装完成')

# 下载并安装JDK 17（使用Eclipse Temurin/Adoptium）
print('\\n正在下载OpenJDK 17...')
jdk_url = 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.9%2B9/OpenJDK17U-jdk_x64_linux_hotspot_17.0.9_9.tar.gz'
jdk_dir = '/opt/java'
os.makedirs(jdk_dir, exist_ok=True)

result = subprocess.run(
    ['curl', '-L', '-o', '/tmp/jdk.tar.gz', jdk_url],
    capture_output=True,
    text=True
)
if result.returncode != 0:
    print(f'下载JDK失败: {result.stderr}')
    sys.exit(1)

print('正在解压JDK...')
result = subprocess.run(
    ['tar', '-xzf', '/tmp/jdk.tar.gz', '-C', jdk_dir, '--strip-components=1'],
    capture_output=True,
    text=True
)
if result.returncode != 0:
    print(f'解压JDK失败: {result.stderr}')
    sys.exit(1)

print('✓ OpenJDK 17 安装完成')

# 下载并安装Maven 3.9（使用清华镜像或官方存档）
print('\\n正在下载Maven 3.9...')
# 使用Apache存档URL（更稳定）
mvn_url = 'https://archive.apache.org/dist/maven/maven-3/3.9.6/binaries/apache-maven-3.9.6-bin.tar.gz'
mvn_dir = '/opt/maven'
os.makedirs(mvn_dir, exist_ok=True)

result = subprocess.run(
    ['curl', '-L', '-o', '/tmp/maven.tar.gz', mvn_url],
    capture_output=True,
    text=True
)
if result.returncode != 0:
    print(f'下载Maven失败: {result.stderr}')
    sys.exit(1)

print('正在解压Maven...')
result = subprocess.run(
    ['tar', '-xzf', '/tmp/maven.tar.gz', '-C', mvn_dir, '--strip-components=1'],
    capture_output=True,
    text=True
)
if result.returncode != 0:
    print(f'解压Maven失败: {result.stderr}')
    sys.exit(1)

print('✓ Maven 3.9 安装完成')

# 设置环境变量（通过profile）
print('\\n正在配置环境变量...')
profile_content = '''
export JAVA_HOME=/opt/java
export MAVEN_HOME=/opt/maven
export PATH=$JAVA_HOME/bin:$MAVEN_HOME/bin:$PATH
'''
with open('/etc/profile.d/java-maven.sh', 'w') as f:
    f.write(profile_content)

# 同时添加到bashrc
with open('/home/user/.bashrc', 'a') as f:
    f.write(profile_content)

print('✓ 环境变量已配置')

# 创建符号链接确保PATH可用
os.makedirs('/usr/local/bin', exist_ok=True)
for cmd in ['java', 'javac', 'jar']:
    src = f'/opt/java/bin/{cmd}'
    dst = f'/usr/local/bin/{cmd}'
    if os.path.exists(src) and not os.path.exists(dst):
        os.symlink(src, dst)
for cmd in ['mvn']:
    src = f'/opt/maven/bin/{cmd}'
    dst = f'/usr/local/bin/{cmd}'
    if os.path.exists(src) and not os.path.exists(dst):
        os.symlink(src, dst)

print('✓ 符号链接已创建')

# 验证安装
print('\\n=== 验证安装 ===')
java_result = subprocess.run(['/opt/java/bin/java', '-version'], capture_output=True, text=True)
print(f'Java版本: {java_result.stderr.strip()}')

mvn_result = subprocess.run(['/opt/maven/bin/mvn', '-version'], capture_output=True, text=True, env={**os.environ, 'JAVA_HOME': '/opt/java'})
print(f'Maven版本: {mvn_result.stdout.strip()}')

# 创建工作目录
os.makedirs('/home/user/app/src/main/java', exist_ok=True)
os.makedirs('/home/user/app/src/test/java', exist_ok=True)
os.makedirs('/home/user/app/src/main/resources', exist_ok=True)
print('\\n✓ Maven项目目录结构已创建')

# 清理下载文件
subprocess.run(['rm', '-f', '/tmp/jdk.tar.gz', '/tmp/maven.tar.gz'], capture_output=True)
print('✓ 临时文件已清理')

print('\\n=== Maven/JDK环境设置完成 ===')
    `;

    const result = await runCodeWithRetry(installScript);

    const output = result.logs.stdout.join('\n');
    const stderr = result.logs.stderr.join('\n');

    console.log('[E2BProvider] Maven setup output:', output);
    if (stderr) {
      console.log('[E2BProvider] Maven setup stderr:', stderr);
    }

    // 检查是否安装成功
    if (result.error) {
      const errorMsg = typeof result.error === 'object'
        ? JSON.stringify(result.error)
        : String(result.error);
      throw new Error(`Maven environment setup failed: ${errorMsg}`);
    }

    // 检查输出中是否有致命错误
    if (output.includes('sys.exit(1)') || output.includes('安装错误') || output.includes('下载JDK失败') || output.includes('下载Maven失败')) {
      throw new Error(`Maven environment setup failed. Output: ${output.substring(0, 500)}`);
    }

    console.log('[E2BProvider] Maven/JDK environment ready');
  }

  async restartViteServer(): Promise<void> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }


    await this.sandbox.runCode(`
import subprocess
import time
import os

os.chdir('/home/user/app')

# Kill existing Vite process
subprocess.run(['pkill', '-f', 'vite'], capture_output=True)
time.sleep(2)

# Start Vite dev server
env = os.environ.copy()
env['FORCE_COLOR'] = '0'

process = subprocess.Popen(
    ['npm', 'run', 'dev'],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    env=env
)

print(f'✓ Vite restarted with PID: {process.pid}')
    `);
    
    // Wait for Vite to be ready
    await new Promise(resolve => setTimeout(resolve, appConfig.e2b.viteStartupDelay));
  }

  getSandboxUrl(): string | null {
    return this.sandboxInfo?.url || null;
  }

  getSandboxInfo(): SandboxInfo | null {
    return this.sandboxInfo;
  }

  async terminate(): Promise<void> {
    if (this.sandbox) {
      try {
        await this.sandbox.kill();
      } catch (e) {
        console.error('Failed to terminate sandbox:', e);
      }
      this.sandbox = null;
      this.sandboxInfo = null;
    }
  }

  isAlive(): boolean {
    return !!this.sandbox;
  }
}
