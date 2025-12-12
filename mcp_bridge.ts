
import { spawn } from 'child_process';
import { createInterface } from 'readline';

// Configuration for the MCP Server to bridge to
const MCP_SERVER_COMMAND = 'npx';
const MCP_SERVER_ARGS = ['-y', '@executeautomation/playwright-mcp-server', '--registry=https://registry.npmjs.org/'];
const MCP_SERVER_ENV = { 
    ...process.env,
    // Ensure this points to your actual browser install location
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '/Users/apus/Library/Caches/ms-playwright',
    npm_config_cache: './.npm-cache', // Fix for EACCES error
    // Add this to skip browser download during mcp server startup if it tries to do it (it shouldn't, but good for safety)
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' 
};

async function runMcpTool(toolName: string, toolArgs: any) {
  return new Promise((resolve, reject) => {
    const serverProcess = spawn(MCP_SERVER_COMMAND, MCP_SERVER_ARGS, {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: MCP_SERVER_ENV
    });

    const stdin = serverProcess.stdin;
    const stdout = serverProcess.stdout;
    const reader = createInterface({ input: stdout });

    let isInitialized = false;
    let pendingRequestId = 0;

    // Helper to send JSON-RPC message
    const send = (msg: any) => {
        const json = JSON.stringify(msg);
        stdin.write(json + '\n');
    };

    // 1. Initialize immediately
    send({
      jsonrpc: '2.0',
      id: ++pendingRequestId,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'gemini-cli-bridge', version: '1.0.0' }
      }
    });

    reader.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const response = JSON.parse(line);
        
        // Handle Initialization
        if (!isInitialized && response.result && response.result.serverInfo) {
            isInitialized = true;
            send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            
            // Now call the requested tool
            send({
                jsonrpc: '2.0',
                id: ++pendingRequestId,
                method: 'tools/call',
                params: {
                    name: toolName,
                    arguments: toolArgs
                }
            });
            return;
        }

        // Handle Tool Result
        if (isInitialized && response.id === pendingRequestId) {
            if (response.error) {
                reject(new Error(`MCP Error: ${response.error.message}`));
            } else {
                resolve(response.result);
            }
            // Clean exit
            serverProcess.kill();
        }

      } catch (err) {
        // Ignore parse errors for non-JSON logs
      }
    });

    serverProcess.on('error', (err) => reject(err));
  });
}

// Main Entry Point
async function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error('Usage: npx tsx mcp_bridge.ts <tool_name> [json_arguments]');
        process.exit(1);
    }

    const toolName = args[0];
    const jsonArgs = args[1] ? JSON.parse(args[1]) : {};

    try {
        console.log(`Calling MCP Tool: ${toolName}...`);
        const result = await runMcpTool(toolName, jsonArgs);
        console.log('Result:');
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Failed:', error);
        process.exit(1);
    }
}

main();
