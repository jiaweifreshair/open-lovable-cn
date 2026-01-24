/**
 * apply 阶段导入/占位修复回归脚本
 *
 * 运行方式：
 *   npx tsx tests/run-import-fixes-tests.ts
 */

import assert from 'node:assert/strict';
import { buildPlaceholderForMissingImport, mergeReactImports } from '../lib/import-fixes';

let passCount = 0;
let failCount = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    // eslint-disable-next-line no-console
    console.log(`  ✅ ${name}`);
    passCount++;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log(`  ❌ ${name}`);
    // eslint-disable-next-line no-console
    console.log(`     Error: ${(e as Error).message}`);
    failCount++;
  }
}

// eslint-disable-next-line no-console
console.log('\n🧪 apply 导入/占位修复测试\n' + '='.repeat(50));

test('mergeReactImports: 合并重复的 react 导入并去重 hook', () => {
  const input = [
    "import React , { useContext } from 'react';",
    "import { BrowserRouter as Router } from 'react-router-dom';",
    "import { useContext } from 'react';",
    '',
    'export default function App() {',
    '  return null;',
    '}',
    ''
  ].join('\n');

  const result = mergeReactImports(input);
  assert.equal(result.changed, true);

  const reactImportLines = result.content
    .split('\n')
    .filter(line => line.includes("from 'react'") && line.trim().startsWith('import '));

  assert.equal(reactImportLines.length, 1);
  assert.ok(reactImportLines[0].includes('useContext'));
  assert.ok(!result.content.includes("import { useContext } from 'react'"));
});

test('buildPlaceholderForMissingImport: 支持 Context/Provider named exports（避免与 default 冲突）', () => {
  const output = buildPlaceholderForMissingImport('src/context/AuthContext.jsx', {
    namedExports: ['AuthProvider', 'AuthContext']
  });

  assert.ok(output.includes('export const AuthContext'));
  assert.ok(output.includes('export function AuthProvider'));

  // 不应输出 `export default function AuthContext()`，否则会与 `export const AuthContext` 冲突
  assert.ok(!output.includes('export default function AuthContext('));
});

test('buildPlaceholderForMissingImport: 无导入信息时保持默认组件占位', () => {
  const output = buildPlaceholderForMissingImport('src/components/Widget.jsx');
  assert.ok(output.includes('export default function Widget'));
});

// eslint-disable-next-line no-console
console.log(`\nDone. passed=${passCount}, failed=${failCount}`);

if (failCount > 0) {
  process.exitCode = 1;
}

