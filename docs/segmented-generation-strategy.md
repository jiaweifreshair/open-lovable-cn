# 🔥 分段生成策略 (Segmented Generation Strategy) - V3.0

## 核心理念：需求 → 方案 → 清单 → 代码

### 完整工作流程

```
用户需求
    ↓
[Phase 0: Plan] 🆕 生成技术方案规划
    ├── 需求分析
    ├── 技术选型
    ├── 架构设计
    ├── 文件拆解
    ├── 实现步骤
    └── 风险评估
    ↓
[Phase 1: Manifest] 生成文件清单
    ↓
    文件清单 [
      App.jsx,
      Header.jsx,
      Footer.jsx,
      ...
    ]
    ↓
[Phase 2: File-by-File] 逐个生成文件
    ↓
    → 生成 App.jsx ✓
    → 生成 Header.jsx ✓
    → 生成 Footer.jsx ✓
    → ...
    ↓
完成！所有文件生成成功
```

## 问题背景

### 原有问题（V2.0及之前）
在一次性生成所有文件的模式下，存在以下问题：

1. **Token超限**：一次性生成10+文件容易触发AI模型的token限制
2. **代码截断**：超过token限制时，AI会在中途截断，导致代码不完整
3. **续写混乱**：续写时AI失去位置感知，可能出现：
   - `import` 语句插入到函数体中间
   - 跨文件代码混乱（组件A的代码出现在组件B中）
   - JSX 内部出现函数定义
   - 函数体结构被破坏
4. **难以修复**：即使有自动修复机制，结构性错误很难恢复

### 根本原因
- 系统设计问题 > 模型问题
- 一次性生成 → Token超限 → 截断 → AI "幻觉" → 代码混乱

## 解决方案：分段生成策略

### 核心思想
**"分而治之"** - 将大任务拆分为小任务，逐个完成

### 工作流程

```
用户需求
    ↓
[Phase 1: Manifest] 生成文件清单
    ↓
    文件清单 [
      App.jsx,
      Header.jsx,
      Footer.jsx,
      ...
    ]
    ↓
[Phase 2: File-by-File] 逐个生成文件
    ↓
    → 生成 App.jsx ✓
    → 生成 Header.jsx ✓
    → 生成 Footer.jsx ✓
    → ...
    ↓
完成！所有文件生成成功
```

## API 使用方法

### 0. 🆕 生成技术方案 (Plan Mode) - **推荐第一步**

**为什么需要Plan模式？**
- ✅ **用户可见性**：看到AI的思考过程，增强信任
- ✅ **提前发现问题**：在方案阶段就能发现需求理解偏差
- ✅ **提高代码质量**：AI有明确的执行目标
- ✅ **用户可干预**：可以在看到方案后决定是否继续或调整

**请求示例**：
```typescript
const response = await fetch('/api/generate-ai-code-stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: "创建一个心情日记应用，包含心情输入、日历展示、统计图表功能",
    model: "deepseek-r1",
    context: {
      sandboxId: "your-sandbox-id",
      currentFiles: {}
    },
    generation: {
      mode: 'plan' // 🔥 第一步：生成技术方案
    }
  })
});

// Streaming 接收方案（打字机效果）
const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value);
  const lines = chunk.split('\n\n');

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));

      if (data.type === 'plan_chunk') {
        // 实时显示方案内容（打字机效果）
        console.log(data.chunk);
        // 渲染 Markdown：renderMarkdown(data.chunk);
      }

      if (data.type === 'plan_complete') {
        // 方案生成完成
        const plan = data.plan;
        console.log('方案完成:', plan.summary);
        console.log('建议文件数:', plan.suggestedManifest.length);
      }
    }
  }
}
```

**响应示例**：
```json
{
  "success": true,
  "mode": "plan",
  "plan": {
    "content": "# 技术实现方案\n\n## 1. 需求分析\n...",
    "suggestedManifest": [
      {
        "path": "src/App.jsx",
        "description": "应用主入口",
        "type": "page",
        "dependencies": [],
        "isCritical": true,
        "estimatedLines": 60
      }
    ],
    "summary": {
      "requirementAnalysis": "心情日记应用，核心功能包括...",
      "techStack": ["React", "Tailwind CSS", "Chart.js"],
      "architecture": "单页应用架构，使用 Context 进行状态管理...",
      "totalFiles": 8,
      "estimatedTime": 45,
      "risks": [
        "日历组件性能优化需要注意",
        "数据持久化方案需明确"
      ]
    }
  }
}
```

### 1. 生成文件清单 (Manifest Mode)

**请求示例**：
```typescript
const response = await fetch('/api/generate-ai-code-stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: "创建一个心情日记应用，包含心情输入、日历展示、统计图表功能",
    model: "deepseek-r1",
    context: {
      sandboxId: "your-sandbox-id",
      currentFiles: {}
    },
    generation: {
      mode: 'manifest' // 🔥 指定 manifest 模式
    }
  })
});

const result = await response.json();
console.log(result);
```

**响应示例**：
```json
{
  "success": true,
  "mode": "manifest",
  "totalFiles": 5,
  "estimatedTime": 45,
  "manifest": [
    {
      "path": "src/App.jsx",
      "description": "应用主入口，配置路由和全局状态",
      "type": "page",
      "dependencies": ["src/components/Header.jsx", "src/pages/Home.jsx"],
      "isCritical": true,
      "estimatedLines": 60
    },
    {
      "path": "src/components/Header.jsx",
      "description": "页头组件，包含导航和Logo",
      "type": "component",
      "dependencies": [],
      "isCritical": false,
      "estimatedLines": 30
    },
    // ... 更多文件
  ]
}
```

### 2. 逐个生成文件 (File Mode)

基于 Manifest 的结果，逐个生成文件：

```typescript
// 假设已获得 manifest
const manifest = result.manifest;

// 循环生成每个文件
for (let i = 0; i < manifest.length; i++) {
  const fileResponse = await fetch('/api/generate-ai-code-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: "创建一个心情日记应用", // 原始需求
      model: "deepseek-r1",
      context: {
        sandboxId: "your-sandbox-id",
        currentFiles: {} // 已生成的文件会自动包含
      },
      generation: {
        mode: 'file',        // 🔥 指定 file 模式
        manifest: manifest,  // 传入完整 manifest
        fileIndex: i         // 当前生成第几个文件
      }
    })
  });

  const fileResult = await fileResponse.json();
  console.log(`Generated: ${fileResult.file.path}`);
  console.log(`Progress: ${fileResult.progress}%`);

  // 将生成的文件添加到 currentFiles
  context.currentFiles[fileResult.file.path] = fileResult.file.content;

  if (fileResult.isComplete) {
    console.log('✅ 所有文件生成完成！');
    break;
  }
}
```

**单文件响应示例**：
```json
{
  "success": true,
  "mode": "file",
  "fileIndex": 0,
  "totalFiles": 5,
  "progress": 20,
  "isComplete": false,
  "file": {
    "path": "src/App.jsx",
    "content": "import React from 'react';\n..."
  }
}
```

### 3. 向后兼容：Full Mode

如果不想使用分段生成，可以继续使用原有的 full 模式（默认）：

```typescript
const response = await fetch('/api/generate-ai-code-stream', {
  method: 'POST',
  body: JSON.stringify({
    prompt: "创建一个心情日记应用",
    // generation 参数省略，默认使用 full 模式
    // 或显式指定：generation: { mode: 'full' }
  })
});
```

## 技术优势

### 1. 避免 Token 超限
- 每次只生成文件清单或单个文件
- 单个文件通常 < 500行，远低于 token 限制
- 永远不会因为项目过大而失败

### 2. 保持代码完整性
- 每个文件都是完整生成的
- AI 专注于单个文件，不会跨文件混乱
- 结构清晰，import 位置正确

### 3. 增强可控性
- 可以随时暂停、恢复生成
- 可以跳过某些文件
- 可以重新生成失败的文件
- 进度可视化（20%, 40%, 60%...）

### 4. 优化依赖管理
- Manifest 明确了文件间的依赖关系
- 按依赖顺序生成（被依赖的先生成）
- 生成时可引用已生成文件的上下文

### 5. 提升用户体验
- 实时进度反馈
- 明确的任务划分
- 失败时只需重试单个文件

## 性能对比

| 维度 | Full Mode (V2.0) | Segmented Mode (V3.0) |
|------|------------------|----------------------|
| **Token 使用** | 10,000+ tokens | 500-2000 tokens/file |
| **代码完整率** | 60-70% | 95%+ |
| **跨文件混乱** | 经常发生 | 基本杜绝 |
| **失败恢复** | 需重新生成所有文件 | 只需重试单个文件 |
| **进度可见性** | 无 | 实时百分比 |
| **并发支持** | 难以实现 | 容易并发生成多个文件 |

## 最佳实践

### 1. 何时使用 Segmented Mode
- ✅ 项目包含 5+ 文件
- ✅ 单个文件预计 > 100行
- ✅ 需要精确控制生成顺序
- ✅ 对代码质量要求高

### 2. 何时使用 Full Mode
- ✅ 快速原型（< 3个文件）
- ✅ 简单的单页应用
- ✅ 向后兼容旧代码

### 3. 错误处理
```typescript
try {
  const fileResult = await generateFile(i);
  // 保存成功
} catch (error) {
  // 重试机制
  console.error(`文件 ${i} 生成失败，准备重试...`);
  const retryResult = await generateFile(i);
}
```

### 4. 进度展示
```tsx
<Progress
  value={progress}
  label={`正在生成 ${fileIndex + 1}/${totalFiles}: ${currentFile}`}
/>
```

## 配置选项

```typescript
interface GenerationConfig {
  mode: 'full' | 'manifest' | 'file';
  manifest?: FileManifestItem[];
  fileIndex?: number;
  strictValidation?: boolean;      // 默认 true - 启用严格验证
  maxTokensPerFile?: number;       // 默认 4000 - 单文件最大token数
}
```

## 常见问题 (FAQ)

### Q1: Manifest 模式会消耗额外的 AI 调用吗？
**A**: 是的，但开销很小（通常 < 500 tokens），相比于避免的代码重生成，成本极低。

### Q2: 文件生成顺序重要吗？
**A**: 重要。建议按 Manifest 返回的顺序生成，因为已经考虑了依赖关系。

### Q3: 可以并发生成多个文件吗？
**A**: 可以，但建议按依赖顺序串行生成，避免依赖文件未生成时引用错误。

### Q4: 如果某个文件生成失败怎么办？
**A**: 只需重新调用相同的 fileIndex，不影响其他文件。

### Q5: 生成的文件会自动验证吗？
**A**: 会。每个文件生成后会进行基础验证（import位置、语法结构等）。

## 实现细节

### Manifest 生成 Prompt
- 系统提示词：`你是一个专业的前端架构师，擅长分析需求并规划项目文件结构。`
- Temperature: `0.3` （低温度获得稳定输出）
- 输出格式：严格的 JSON 结构

### 单文件生成 Prompt
- 包含原始需求上下文
- 包含依赖文件的前500字符作为参考
- 明确要求只生成当前文件
- Temperature: `0.5` （平衡创造性和稳定性）

## 总结

分段生成策略是一个**治本**的解决方案，从根本上解决了一次性生成导致的各种问题：

✅ **Token超限** → 每次只生成小文件
✅ **代码截断** → 单文件必定完整
✅ **跨文件混乱** → 每次只关注一个文件
✅ **续写错误** → 避免续写，直接生成完整文件
✅ **难以修复** → 失败只需重试单个文件

**推荐：所有 5+ 文件的项目都使用 Segmented Mode！**
