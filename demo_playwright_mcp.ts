
import { spawn } from 'child_process';
import { createInterface } from 'readline';

async function runDemo() {
  console.log('Starting Playwright MCP Server via npx...');

  // Start the MCP server using npx
  // We use stdio for communication (stdin/stdout)
  const serverProcess = spawn('npx', ['-y', '@executeautomation/playwright-mcp-server', '--registry=https://registry.npmjs.org/'], {
    stdio: ['pipe', 'pipe', 'inherit'], // pipe stdin/stdout, inherit stderr for logs
    env: { 
        ...process.env,
        npm_config_cache: './.npm-cache' // Use local cache to avoid permission issues
    }
  });

  const stdin = serverProcess.stdin;
  const stdout = serverProcess.stdout;
  const reader = createInterface({ input: stdout });

  console.log('Server started. Sending initialize request...');

  // 1. Initialize Request
  const initRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'demo-client',
        version: '1.0.0'
      }
    }
  };

  stdin.write(JSON.stringify(initRequest) + '\n');

  let isInitialized = false;

  reader.on('line', async (line) => {
    if (!line.trim()) return;
    
    try {
      const response = JSON.parse(line);
      console.log('Received response:', JSON.stringify(response, null, 2));

      if (response.id === 1) {
        // Initialize response received
        console.log('Initialization successful!');
        
        // Send initialized notification
        stdin.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized'
        }) + '\n');
        
        isInitialized = true;

        // 2. List Tools
        console.log('Listing available tools...');
        stdin.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list'
        }) + '\n');
      } 
      else if (response.id === 2) {
        // Tools list received
        console.log('Tools listed successfully.');
        const tools = response.result.tools;
        const navigateTool = tools.find((t: any) => t.name === 'playwright_navigate');
        
        if (navigateTool) {
            console.log('Found playwright_navigate tool. Executing...');
            
            // 3. Execute Tool: Navigate to example.com
            const navigateRequest = {
                jsonrpc: '2.0',
                id: 3,
                method: 'tools/call',
                params: {
                    name: 'playwright_navigate',
                    arguments: {
                        url: 'https://example.com'
                    }
                }
            };
            stdin.write(JSON.stringify(navigateRequest) + '\n');
        } else {
            console.error('playwright_navigate tool not found!');
            process.exit(1);
        }
      }
      else if (response.id === 3) {
          // Navigate result
          console.log('Navigation completed!');
          console.log('Result:', response.result);
          
          // 4. Take Screenshot
          console.log('Taking screenshot...');
          const screenshotRequest = {
              jsonrpc: '2.0',
              id: 4,
              method: 'tools/call',
              params: {
                  name: 'playwright_screenshot',
                  arguments: {
                      name: 'example_screenshot'
                  }
              }
          };
          stdin.write(JSON.stringify(screenshotRequest) + '\n');
      }
      else if (response.id === 4) {
          console.log('Screenshot taken!');
          // Don't log full screenshot data as it's base64
          console.log('Screenshot result received (truncated for log).');
          
          console.log('Demo completed successfully. Closing server...');
          serverProcess.kill();
          process.exit(0);
      }

    } catch (error) {
      console.error('Error parsing response:', error);
    }
  });

  serverProcess.on('close', (code) => {
    console.log(`Server process exited with code ${code}`);
  });
  
  serverProcess.on('error', (err) => {
      console.error('Failed to start server process:', err);
  });
}

runDemo().catch(console.error);
