# 前端集成 Plan 模式 - 实现指南

## 概述

本文档说明如何在 `app/generation/page.tsx` 中集成 Plan 模式，实现：
1. 用户提交需求 → 先生成技术方案（打字机效果）
2. 用户查看并确认方案
3. 自动开始代码生成 → 应用到沙箱 → 预览

---

## 核心流程

```
用户输入需求
    ↓
调用 mode: 'plan'
    ↓
TechnicalPlanView 实时显示方案（打字机 + Markdown）
    ↓
用户点击"确认方案"
    ↓
自动调用 mode: 'file' 逐个生成文件
    ↓
应用到沙箱 (/api/apply-ai-code-stream)
    ↓
预览
```

---

## 实现步骤

### Step 1: 添加状态管理

在 `app/generation/page.tsx` 中添加以下状态：

```typescript
// Plan 模式相关状态
const [planMode, setPlanMode] = useState<'idle' | 'generating' | 'complete'>('idle');
const [planContent, setPlanContent] = useState('');
const [planSummary, setPlanSummary] = useState<any>(null);
const [suggestedManifest, setSuggestedManifest] = useState<any[]>([]);
```

### Step 2: 修改提交处理函数

修改用户提交需求的处理函数，先调用 Plan 模式：

```typescript
const handleSubmit = async (message: string) => {
  // 1. 先生成技术方案
  setPlanMode('generating');
  setPlanContent('');
  setActiveTab('generation'); // 切换到 generation tab 显示方案

  try {
    const response = await fetch('/api/generate-ai-code-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: message,
        model: aiModel,
        context: {
          sandboxId: sandboxData?.sandboxId,
          currentFiles: sandboxFiles
        },
        generation: {
          mode: 'plan' // 🔥 第一步：生成技术方案
        }
      })
    });

    // 2. Streaming 接收方案内容
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));

          // 实时更新方案内容（打字机效果）
          if (data.type === 'plan_chunk') {
            setPlanContent(prev => prev + data.chunk);
          }

          // 方案生成完成
          if (data.type === 'plan_complete') {
            setPlanMode('complete');
            setPlanSummary(data.plan.summary);
            setSuggestedManifest(data.plan.suggestedManifest);
            console.log('✅ 技术方案生成完成');
          }
        }
      }
    }
  } catch (error) {
    console.error('技术方案生成失败:', error);
    setPlanMode('idle');
  }
};
```

### Step 3: 处理方案确认

用户确认方案后，自动开始代码生成：

```typescript
const handlePlanConfirm = async (manifest: any[]) => {
  console.log('用户确认方案，开始生成代码...');

  // 3. 使用建议的 manifest 逐个生成文件
  for (let i = 0; i < manifest.length; i++) {
    const response = await fetch('/api/generate-ai-code-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: originalPrompt, // 原始用户需求
        model: aiModel,
        context: {
          sandboxId: sandboxData?.sandboxId,
          currentFiles: sandboxFiles
        },
        generation: {
          mode: 'file',
          manifest: manifest,
          fileIndex: i
        }
      })
    });

    const result = await response.json();

    // 更新生成进度
    setGenerationProgress(prev => ({
      ...prev,
      files: [...prev.files, result.file],
      progress: result.progress
    }));

    // 应用文件到沙箱
    await applyFileToSandbox(result.file);
  }

  // 4. 所有文件生成完成，切换到预览
  setActiveTab('preview');
  console.log('✅ 代码生成完成，切换到预览');
};

// 应用文件到沙箱
const applyFileToSandbox = async (file: { path: string; content: string }) => {
  await fetch('/api/apply-ai-code-stream', {
    method: 'POST',
    body: JSON.stringify({
      sandboxId: sandboxData?.sandboxId,
      files: [file]
    })
  });
};
```

### Step 4: 渲染 TechnicalPlanView

在 `renderMainContent()` 函数中添加方案显示逻辑：

```typescript
const renderMainContent = () => {
  // 如果正在生成方案或方案已完成，显示 TechnicalPlanView
  if (planMode === 'generating' || planMode === 'complete') {
    return (
      <TechnicalPlanView
        planContent={planContent}
        isGenerating={planMode === 'generating'}
        summary={planSummary}
        suggestedManifest={suggestedManifest}
        onConfirm={handlePlanConfirm}
        onEdit={() => {
          // 用户想修改方案，返回输入界面
          setPlanMode('idle');
          setPlanContent('');
        }}
        onCancel={() => {
          // 取消方案，返回输入界面
          setPlanMode('idle');
          setPlanContent('');
        }}
      />
    );
  }

  // 原有的代码生成逻辑...
  if (activeTab === 'generation' && generationProgress.isGenerating) {
    // ...
  }

  // 预览逻辑...
  if (activeTab === 'preview') {
    // ...
  }
};
```

---

## 完整流程示例

```typescript
// 1. 用户提交需求
handleSubmit("创建一个心情日记应用");

// 2. 后端生成技术方案 (mode: 'plan')
// → TechnicalPlanView 实时显示方案（打字机效果）

// 3. 用户查看方案，点击"确认方案"
handlePlanConfirm(suggestedManifest);

// 4. 后端逐个生成文件 (mode: 'file')
// → 实时显示文件生成进度

// 5. 文件生成完成，应用到沙箱
applyFileToSandbox(file);

// 6. 切换到预览 Tab
setActiveTab('preview');
```

---

## UI/UX 设计要点

### 方案显示阶段
- ✅ 打字机效果：逐字显示，提升期待感
- ✅ Markdown 渲染：代码高亮、列表、标题等格式化
- ✅ 方案摘要卡片：技术栈、文件数、预估时间、风险点
- ✅ 操作按钮：确认方案、修改方案、取消

### 代码生成阶段
- ✅ 文件生成进度条：X/Y 文件已生成
- ✅ 实时代码预览：显示正在生成的文件
- ✅ 错误处理：失败时可重试单个文件

### 预览阶段
- ✅ 无缝切换：代码生成完成后自动切换到预览
- ✅ 沙箱加载：显示沙箱加载状态
- ✅ iframe 预览：实时预览应用效果

---

## 优化建议

### 1. 缓存方案
用户可能想查看之前的方案，可以缓存方案内容：

```typescript
const [planHistory, setPlanHistory] = useState<any[]>([]);

// 方案完成后保存到历史
setPlanHistory(prev => [...prev, {
  timestamp: Date.now(),
  content: planContent,
  summary: planSummary,
  manifest: suggestedManifest
}]);
```

### 2. 方案修改
用户可能想微调方案，可以提供编辑功能：

```typescript
const handlePlanEdit = () => {
  // 显示方案编辑器
  setShowPlanEditor(true);
  setPlanEditorContent(planContent);
};
```

### 3. 跳过方案
对于简单项目，可以提供"跳过方案"选项：

```typescript
<button onClick={() => {
  // 直接开始代码生成，跳过方案
  setPlanMode('idle');
  handleDirectGenerate();
}}>
  跳过方案，直接生成代码
</button>
```

---

## 测试检查清单

- [ ] 方案生成：打字机效果流畅
- [ ] Markdown 渲染：代码高亮、列表、标题正确
- [ ] 方案摘要：数据准确（技术栈、文件数等）
- [ ] 确认方案：自动开始代码生成
- [ ] 修改方案：返回输入界面
- [ ] 取消方案：清空状态
- [ ] 文件生成：进度实时更新
- [ ] 预览切换：代码生成完成后自动切换
- [ ] 错误处理：网络失败、解析失败等

---

## 调试技巧

### 1. 查看 Plan API 响应
```typescript
console.log('[Plan] Response:', {
  content: planContent.substring(0, 100) + '...',
  summary: planSummary,
  manifestCount: suggestedManifest?.length
});
```

### 2. 模拟方案数据
```typescript
// 开发时可以使用模拟数据快速测试 UI
const mockPlan = {
  content: '# 技术实现方案\\n\\n## 1. 需求分析\\n...',
  summary: {
    requirementAnalysis: '心情日记应用...',
    techStack: ['React', 'Tailwind CSS'],
    architecture: '单页应用架构...',
    totalFiles: 8,
    estimatedTime: 45,
    risks: ['日历性能优化']
  },
  suggestedManifest: [
    { path: 'src/App.jsx', description: '主入口', type: 'page' }
  ]
};
```

---

## 总结

通过集成 Plan 模式，用户可以：
1. ✅ 看到 AI 的详细分析和思考过程
2. ✅ 在代码生成前验证技术方案
3. ✅ 提前发现需求理解偏差
4. ✅ 提高对生成代码的信任度

**推荐：所有项目都启用 Plan 模式！**
