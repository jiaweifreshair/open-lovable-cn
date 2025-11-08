import { NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';

declare global {
  var activeSandboxProvider: any;
  var sandboxData: any;
  var existingFiles: Set<string>;
}

export async function POST() {
  try {
    console.log('[kill-sandbox] Stopping all sandboxes...');

    let sandboxKilled = false;

    // Terminate all sandboxes managed by sandboxManager
    try {
      await sandboxManager.terminateAll();
      sandboxKilled = true;
      console.log('[kill-sandbox] All managed sandboxes terminated');
    } catch (e) {
      console.error('[kill-sandbox] Failed to terminate managed sandboxes:', e);
    }

    // Stop legacy global sandbox if any
    if (global.activeSandboxProvider) {
      try {
        await global.activeSandboxProvider.terminate();
        sandboxKilled = true;
        console.log('[kill-sandbox] Legacy global sandbox stopped');
      } catch (e) {
        console.error('[kill-sandbox] Failed to stop legacy sandbox:', e);
      }
      global.activeSandboxProvider = null;
      global.sandboxData = null;
    }

    // Clear existing files tracking
    if (global.existingFiles) {
      global.existingFiles.clear();
    }

    return NextResponse.json({
      success: true,
      sandboxKilled,
      message: 'All sandboxes cleaned up successfully'
    });
    
  } catch (error) {
    console.error('[kill-sandbox] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: (error as Error).message 
      }, 
      { status: 500 }
    );
  }
}