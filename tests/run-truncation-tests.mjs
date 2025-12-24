/**
 * 截断检测逻辑测试脚本
 * 运行方式: node tests/run-truncation-tests.mjs
 */

// ============ 检测函数 ============

/**
 * Check 6: URL 截断检测
 */
function checkUrlTruncation(generatedCode) {
  const trimmedCode = generatedCode.trim();
  const lastLine = trimmedCode.split('\n').pop() || '';
  const urlInProgress = /https?:\/\/[^\s"',>]*$/.test(lastLine);

  if (urlInProgress) {
    return { detected: true, reason: 'URL truncated mid-string' };
  }
  return { detected: false };
}

/**
 * Check 7: 字符串中间截断检测
 */
function checkStringTruncation(generatedCode) {
  const trimmedCode = generatedCode.trim();
  const lastLines = trimmedCode.split('\n').slice(-3).join('\n');

  const singleQuotes = (lastLines.match(/'/g) || []).length;
  const doubleQuotes = (lastLines.match(/"/g) || []).length;
  const backticks = (lastLines.match(/`/g) || []).length;

  if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0 || backticks % 2 !== 0) {
    const lastLine = trimmedCode.split('\n').pop() || '';
    const looksLikeTruncation =
      !lastLine.endsWith(';') &&
      !lastLine.endsWith('}') &&
      !lastLine.endsWith(')') &&
      !lastLine.endsWith('>') &&
      !lastLine.endsWith('</file>');

    if (looksLikeTruncation) {
      return {
        detected: true,
        reason: `String truncated (quotes: single=${singleQuotes}, double=${doubleQuotes}, backtick=${backticks})`
      };
    }
  }
  return { detected: false };
}

/**
 * Check 8: 数组/对象中间截断检测
 */
function checkBracketTruncation(fileContent) {
  const openBraces = (fileContent.match(/\{/g) || []).length;
  const closeBraces = (fileContent.match(/\}/g) || []).length;
  const openBrackets = (fileContent.match(/\[/g) || []).length;
  const closeBrackets = (fileContent.match(/\]/g) || []).length;
  const openParens = (fileContent.match(/\(/g) || []).length;
  const closeParens = (fileContent.match(/\)/g) || []).length;

  const braceDiff = openBraces - closeBraces;
  const bracketDiff = openBrackets - closeBrackets;
  const parenDiff = openParens - closeParens;

  // 🔥 调整阈值：任何未闭合的括号都应该触发截断检测
  const hasUnclosedBrackets = braceDiff >= 1 || bracketDiff >= 1 || parenDiff >= 3;
  const lastFileClosed = fileContent.includes('</file>');

  if (hasUnclosedBrackets && !lastFileClosed) {
    return {
      detected: true,
      reason: `Brackets unbalanced (braces: +${braceDiff}, brackets: +${bracketDiff}, parens: +${parenDiff})`
    };
  }

  const lastLine = fileContent.split('\n').pop() || '';
  const trimmedLastLine = lastLine.trim();
  if (trimmedLastLine.endsWith(',') && (openBraces > closeBraces || openBrackets > closeBrackets)) {
    return {
      detected: true,
      reason: 'Array/object element truncated (ends with comma in unclosed structure)'
    };
  }

  return { detected: false };
}

// ============ 测试框架 ============

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passCount++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${e.message}`);
    failCount++;
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected}, but got ${actual}`);
      }
    },
    toEqual(expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`);
      }
    },
    toContain(expected) {
      if (!actual.includes(expected)) {
        throw new Error(`Expected "${actual}" to contain "${expected}"`);
      }
    }
  };
}

function describe(name, fn) {
  console.log(`\n📦 ${name}`);
  fn();
}

// ============ 测试用例 ============

console.log('\n🧪 截断检测逻辑测试\n' + '='.repeat(50));

describe('URL 截断检测 (Check 6)', () => {
  test('应该检测到未完成的 URL', () => {
    const truncatedCode = `
<file path="src/App.jsx">
const PRODUCTS = [
  { id: 1, title: '商品1', image: 'https://images.unsplash.com/photo-1`;

    const result = checkUrlTruncation(truncatedCode);
    expect(result.detected).toBe(true);
    expect(result.reason).toContain('URL');
  });

  test('应该检测到中间截断的长 URL', () => {
    const truncatedCode = `
const imageUrl = 'https://cdn.example.com/images/products/category/subcategory/item-123456-large-`;

    const result = checkUrlTruncation(truncatedCode);
    expect(result.detected).toBe(true);
  });

  test('不应该误报完整的 URL', () => {
    const completeCode = `
const imageUrl = 'https://images.unsplash.com/photo-123456?w=400';
const nextLine = 'something';`;

    const result = checkUrlTruncation(completeCode);
    expect(result.detected).toBe(false);
  });
});

describe('字符串截断检测 (Check 7)', () => {
  test('应该检测到未闭合的双引号字符串', () => {
    const truncatedCode = `
const title = "这是一个很长的标题，包含很多内容，但是`;

    const result = checkStringTruncation(truncatedCode);
    expect(result.detected).toBe(true);
  });

  test('应该检测到未闭合的单引号字符串', () => {
    const truncatedCode = `
const name = '用户名称：张三`;

    const result = checkStringTruncation(truncatedCode);
    expect(result.detected).toBe(true);
  });

  test('不应该误报完整的字符串', () => {
    const completeCode = `
const title = "完整的标题";
const name = '完整的名字';`;

    const result = checkStringTruncation(completeCode);
    expect(result.detected).toBe(false);
  });
});

describe('数组/对象截断检测 (Check 8)', () => {
  test('应该检测到未闭合的数组', () => {
    const truncatedCode = `
const PRODUCTS = [
  { id: 1, title: '商品1', price: '99.00' },
  { id: 2, title: '商品2', price: '199.00' },
  { id: 3, title: '商品3', price: '299.00' },`;

    const result = checkBracketTruncation(truncatedCode);
    expect(result.detected).toBe(true);
  });

  test('应该检测到未闭合的嵌套对象', () => {
    const truncatedCode = `
const config = {
  name: 'app',
  version: '1.0.0',
  settings: {
    theme: 'dark',
    language: 'zh-CN',`;

    const result = checkBracketTruncation(truncatedCode);
    expect(result.detected).toBe(true);
  });

  test('不应该误报完整的代码', () => {
    const completeCode = `
const PRODUCTS = [
  { id: 1, title: '商品1' },
  { id: 2, title: '商品2' }
];

function App() {
  return <div>Hello</div>;
}`;

    const result = checkBracketTruncation(completeCode);
    expect(result.detected).toBe(false);
  });
});

describe('综合截断场景（模拟用户报告的淘宝页面截断）', () => {
  test('应该检测到淘宝风格页面的 PRODUCTS 数组截断', () => {
    const truncatedTaobaoCode = `
<file path="src/App.jsx">
// --- Mock Data ---

const CATEGORIES = [
  { name: '女装 / 内衣 / 家居', sub: ['连衣裙', 'T恤', '衬衫', '卫衣'] },
  { name: '女鞋 / 男鞋 / 箱包', sub: ['单鞋', '运动鞋', '马丁靴', '双肩包'] },
];

const SERVICES = [
  { name: '天猫', icon: '🐱', color: 'text-red-600' },
  { name: '聚划算', icon: '🔥', color: 'text-pink-600' },
];

const PRODUCTS = [
  { id: 1, title: '2025新款法式复古连衣裙', price: '128.00', sales: '2000+', image: 'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&q=80' },
  { id: 2, title: 'ins超火百搭小白鞋', price: '69.90', sales: '5000+', image: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80' },
  { id: 9, title: '可爱卡通陶瓷马克杯', price: '29.90', sales: '500+', image: 'https://images.unsplash.com/photo-1`;

    // 检测 URL 截断
    const urlResult = checkUrlTruncation(truncatedTaobaoCode);
    expect(urlResult.detected).toBe(true);

    // 检测括号不平衡
    const bracketResult = checkBracketTruncation(truncatedTaobaoCode);
    expect(bracketResult.detected).toBe(true);
  });
});

describe('边界情况测试', () => {
  test('空字符串不应该触发检测', () => {
    expect(checkUrlTruncation('').detected).toBe(false);
    expect(checkStringTruncation('').detected).toBe(false);
    expect(checkBracketTruncation('').detected).toBe(false);
  });

  test('单行完整代码不应该触发检测', () => {
    const singleLine = 'const x = 1;';
    expect(checkUrlTruncation(singleLine).detected).toBe(false);
    expect(checkStringTruncation(singleLine).detected).toBe(false);
    expect(checkBracketTruncation(singleLine).detected).toBe(false);
  });
});

// ============ 测试报告 ============

console.log('\n' + '='.repeat(50));
console.log(`\n📊 测试结果: ${passCount} 通过, ${failCount} 失败`);
console.log(`   总计: ${passCount + failCount} 个测试用例\n`);

if (failCount > 0) {
  process.exit(1);
}
