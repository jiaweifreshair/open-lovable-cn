/**
 * 抓取内容索引（Scrape Index）
 *
 * 目的：
 * - 克隆网站时，抓取内容可能达到几十万字符，直接塞进 LLM prompt 会触发输入硬上限（例如 98KB）。
 * - 通过“结构化概要 + 内容分块索引”，在 manifest 阶段只提供概要；在单文件生成阶段按需检索相关分块注入，
 *   既降低输入体积，又尽量保留关键细节（文案、结构、模块）。
 *
 * 说明：
 * - 这是确定性的本地处理，不调用模型做摘要（避免额外成本与不确定性）。
 * - 最终仍建议保留服务器端的长度兜底截断作为 last resort。
 */

export interface ScrapeChunk {
  /** 分块唯一 ID（同一次 build 内唯一） */
  id: string;
  /** 分块标题/锚点（例如 Markdown 标题） */
  heading?: string;
  /** 分块正文（已裁剪到上限，用于注入模型） */
  text: string;
  /** 分块预览（用于 UI/日志/调试，避免把全文打印出来） */
  preview: string;
  /** 简单关键词（用于检索评分） */
  keywords: string[];
  /** 原始字符长度（裁剪前，如无法获得则等于 text.length） */
  originalCharCount: number;
}

export interface ScrapeProfile {
  /** 站点 URL */
  url: string;
  /** Title（如果能从抓取结果解析到） */
  title?: string;
  /** Description（如果能从抓取结果解析到） */
  description?: string;
  /** 头部/正文的关键标题（用于快速推断页面结构） */
  headings: string[];
  /** 推断出的典型区块（启发式） */
  inferredSections: string[];
  /** 抓取器信息（firecrawl/playwright/cheerio） */
  scraper?: string;
  /** 抓取正文总长度（估算） */
  contentLength?: number;
}

export interface ScrapeIndex {
  /** 结构化概要（体积小，适合 manifest 阶段） */
  profile: ScrapeProfile;
  /** 分块列表（用于单文件按需注入） */
  chunks: ScrapeChunk[];
}

export interface BuildScrapeIndexOptions {
  /** 最多分块数（避免请求体过大） */
  maxChunks: number;
  /** 每个分块注入模型的最大字符数 */
  maxChunkChars: number;
  /** 分块预览最大字符数 */
  maxPreviewChars: number;
  /** 用于提取 headings 的最大数量 */
  maxHeadings: number;
}

const DEFAULT_OPTIONS: BuildScrapeIndexOptions = {
  maxChunks: 60,
  maxChunkChars: 2400,
  maxPreviewChars: 240,
  maxHeadings: 24,
};

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it',
  'of', 'on', 'or', 'that', 'the', 'to', 'with', 'you', 'your', 'we', 'our', 'us',
  'this', 'these', 'those', 'will', 'can', 'may', 'not', 'no', 'yes',
  // 常见中文虚词（极简）
  '的', '了', '和', '与', '及', '在', '对', '把', '是', '有', '为', '就', '都', '而', '还', '也', '很',
]);

/**
 * 从抓取结果中提取“最可能是正文”的原始文本。
 *
 * 兼容：
 * - Firecrawl: { data: { markdown/content }, metadata, ... }
 * - 自定义: { markdown, content, structured: { content } }
 */
export function extractScrapedText(scrapeData: unknown): { text: string; meta: Record<string, unknown> } {
  const data = (scrapeData ?? {}) as Record<string, unknown>;
  const structured = (data.structured ?? {}) as Record<string, unknown>;
  const innerData = (data.data ?? {}) as Record<string, unknown>;
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;

  const candidates: unknown[] = [
    structured.content,
    data.markdown,
    data.content,
    innerData.markdown,
    innerData.content,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      return { text: c, meta: { metadata } };
    }
  }

  // 兜底：尽量不要 stringify 超大对象；只在小对象时尝试
  try {
    const json = JSON.stringify(scrapeData);
    return { text: typeof json === 'string' ? json : '', meta: { metadata } };
  } catch {
    return { text: '', meta: { metadata } };
  }
}

/**
 * 构建抓取索引（概要 + 分块）。
 *
 * 注意：为了避免请求体过大，分块会被裁剪到 maxChunkChars，且最多 maxChunks 个。
 */
export function buildScrapeIndex(params: {
  url: string;
  scrapeData: unknown;
  options?: Partial<BuildScrapeIndexOptions>;
}): ScrapeIndex {
  const { url, scrapeData } = params;
  const options: BuildScrapeIndexOptions = { ...DEFAULT_OPTIONS, ...(params.options || {}) };

  const { text: rawText, meta } = extractScrapedText(scrapeData);
  const normalized = normalizeText(rawText);

  const title = pickString(scrapeData, ['structured.title', 'data.title', 'metadata.title', 'title']);
  const description = pickString(scrapeData, ['structured.description', 'data.description', 'metadata.description', 'description']);
  const scraper =
    pickString(scrapeData, ['metadata.scraper', 'metadata.attemptedScraper', 'scraper']) ||
    pickString(meta, ['metadata.scraper', 'metadata.attemptedScraper']);

  const headings = extractHeadings(normalized, options.maxHeadings);
  const inferredSections = inferSectionsFromText(normalized);

  const profile: ScrapeProfile = {
    url,
    title: title || undefined,
    description: description || undefined,
    headings,
    inferredSections,
    scraper: scraper || undefined,
    contentLength: normalized ? normalized.length : undefined,
  };

  const chunks = chunkText(normalized, {
    maxChunks: options.maxChunks,
    maxChunkChars: options.maxChunkChars,
    maxPreviewChars: options.maxPreviewChars,
  });

  return { profile, chunks };
}

/**
 * 为 manifestItem 选择最相关的抓取分块（按需注入）。
 */
export function selectRelevantScrapeChunks(params: {
  scrapeIndex: ScrapeIndex;
  manifestItem: { path: string; description?: string; type?: string; dependencies?: string[] };
  maxChunks: number;
  maxTotalChars: number;
  perChunkMaxChars: number;
}): ScrapeChunk[] {
  const { scrapeIndex, manifestItem, maxChunks, maxTotalChars, perChunkMaxChars } = params;
  const query = [manifestItem.path, manifestItem.description || '', (manifestItem.dependencies || []).join(' ')].join(' ');
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0) return [];

  const scored = scrapeIndex.chunks
    .map((chunk) => ({
      chunk,
      score: scoreChunk(queryTokens, chunk),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked: ScrapeChunk[] = [];
  let usedChars = 0;

  for (const { chunk } of scored) {
    if (picked.length >= maxChunks) break;

    const trimmedText = chunk.text.length > perChunkMaxChars ? chunk.text.slice(0, perChunkMaxChars) : chunk.text;
    const candidateSize = trimmedText.length;

    if (usedChars + candidateSize > maxTotalChars) continue;

    picked.push({
      ...chunk,
      text: trimmedText,
      preview: chunk.preview,
    });
    usedChars += candidateSize;
  }

  return picked;
}

/**
 * 格式化抓取概要（用于模型 prompt），保证体积小且稳定。
 */
export function formatScrapeProfileForPrompt(profile: ScrapeProfile): string {
  const safe: ScrapeProfile = {
    url: profile.url,
    title: profile.title,
    description: profile.description,
    headings: (profile.headings || []).slice(0, 24),
    inferredSections: (profile.inferredSections || []).slice(0, 16),
    scraper: profile.scraper,
    contentLength: profile.contentLength,
  };
  return JSON.stringify(safe, null, 2);
}

/**
 * 格式化分块（用于模型 prompt），只输出必要字段，避免把无关元数据撑大。
 */
export function formatScrapeChunksForPrompt(chunks: ScrapeChunk[]): string {
  const safe = chunks.map((c) => ({
    id: c.id,
    heading: c.heading || '',
    text: c.text,
  }));
  return JSON.stringify(safe, null, 2);
}

function normalizeText(text: string): string {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ \u00A0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tokenize(text: string): string[] {
  const tokens = (text || '')
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/g)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 2)
    .filter((t) => !STOPWORDS.has(t));

  // 去重并保持相对顺序
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    uniq.push(t);
  }
  return uniq;
}

function scoreChunk(queryTokens: string[], chunk: ScrapeChunk): number {
  if (queryTokens.length === 0) return 0;
  const baseTokens = chunk.keywords.length > 0 ? chunk.keywords : tokenize(chunk.text);
  const headingTokens = chunk.heading ? tokenize(chunk.heading) : [];
  const chunkTokens = new Set<string>([...baseTokens, ...headingTokens]);

  let score = 0;
  for (const t of queryTokens) {
    if (chunkTokens.has(t)) score += 3;
    else if (chunk.text.toLowerCase().includes(t)) score += 1;
  }

  // 轻微偏好带 heading 的块（通常结构更清晰）
  if (chunk.heading) score += 1;
  return score;
}

function extractHeadings(text: string, maxHeadings: number): string[] {
  if (!text) return [];

  const headings: string[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(/^\s{0,3}(#{1,4})\s+(.+?)\s*$/);
    if (m && m[2]) {
      const h = m[2].trim().replace(/\s+/g, ' ');
      if (h && !headings.includes(h)) headings.push(h);
      if (headings.length >= maxHeadings) break;
    }
  }

  // 没有 markdown 标题时，尝试提取 “类似标题”的短行
  if (headings.length === 0) {
    for (const line of lines) {
      const candidate = line.trim();
      if (candidate.length >= 6 && candidate.length <= 60 && /[a-zA-Z\u4e00-\u9fff]/.test(candidate)) {
        headings.push(candidate);
      }
      if (headings.length >= Math.min(8, maxHeadings)) break;
    }
  }

  return headings;
}

function inferSectionsFromText(text: string): string[] {
  const lower = (text || '').toLowerCase();
  const found: string[] = [];

  const rules: Array<{ key: string; patterns: RegExp[] }> = [
    { key: 'header/导航', patterns: [/navbar|navigation|nav\b|menu\b|header\b/, /导航|菜单|页头/] },
    { key: 'hero/首屏', patterns: [/hero\b|headline|subheadline|above the fold/, /首屏|主标题|副标题/] },
    { key: 'features/功能', patterns: [/features?\b|capabilities|what you get/, /功能|特性|亮点/] },
    { key: 'pricing/价格', patterns: [/pricing\b|plans?\b|billing/, /价格|套餐|计费/] },
    { key: 'testimonials/评价', patterns: [/testimonials?\b|reviews?\b|customers?\b/, /评价|客户|口碑/] },
    { key: 'faq/常见问题', patterns: [/faq\b|questions\b|q&a/, /常见问题|FAQ|问答/] },
    { key: 'footer/页脚', patterns: [/footer\b|copyright\b|privacy|terms/, /页脚|隐私|条款/] },
  ];

  for (const r of rules) {
    if (r.patterns.some((p) => p.test(lower))) found.push(r.key);
  }

  return found;
}

function chunkText(
  text: string,
  params: { maxChunks: number; maxChunkChars: number; maxPreviewChars: number }
): ScrapeChunk[] {
  if (!text) return [];

  // 优先按 Markdown 标题拆分
  const sections = splitByMarkdownHeadings(text);
  const chunks: ScrapeChunk[] = [];

  const pushChunk = (heading: string | undefined, body: string, index: number) => {
    const normalizedBody = normalizeText(body);
    if (!normalizedBody) return;

    const originalCharCount = normalizedBody.length;
    const trimmed = normalizedBody.length > params.maxChunkChars ? normalizedBody.slice(0, params.maxChunkChars) : normalizedBody;
    const preview = trimmed.length > params.maxPreviewChars ? trimmed.slice(0, params.maxPreviewChars) : trimmed;
    const keywords = extractKeywords(trimmed, 18);

    chunks.push({
      id: `chunk_${index}`,
      heading: heading || undefined,
      text: trimmed,
      preview,
      keywords,
      originalCharCount,
    });
  };

  let chunkIndex = 0;
  if (sections.length > 1) {
    for (const s of sections) {
      if (chunks.length >= params.maxChunks) break;
      pushChunk(s.heading, s.body, chunkIndex++);
    }
    return chunks;
  }

  // 没有明显标题时，按段落累积
  const paragraphs = text.split(/\n\s*\n/g).map((p) => p.trim()).filter(Boolean);
  let buffer = '';
  let currentHeading: string | undefined = undefined;

  for (const p of paragraphs) {
    const next = buffer ? `${buffer}\n\n${p}` : p;
    if (next.length <= params.maxChunkChars) {
      buffer = next;
      continue;
    }

    if (buffer) {
      pushChunk(currentHeading, buffer, chunkIndex++);
      if (chunks.length >= params.maxChunks) return chunks;
    }

    // 单段落过长时直接切片
    if (p.length > params.maxChunkChars) {
      const slice = p.slice(0, params.maxChunkChars);
      pushChunk(currentHeading, slice, chunkIndex++);
      buffer = '';
      if (chunks.length >= params.maxChunks) return chunks;
      continue;
    }

    buffer = p;
  }

  if (buffer && chunks.length < params.maxChunks) {
    pushChunk(currentHeading, buffer, chunkIndex++);
  }

  return chunks;
}

function splitByMarkdownHeadings(text: string): Array<{ heading?: string; body: string }> {
  const lines = text.split('\n');
  const sections: Array<{ heading?: string; body: string }> = [];
  let currentHeading: string | undefined = undefined;
  let currentBody: string[] = [];

  const flush = () => {
    const body = currentBody.join('\n').trim();
    if (body) sections.push({ heading: currentHeading, body });
    currentBody = [];
  };

  for (const line of lines) {
    const m = line.match(/^\s{0,3}(#{1,4})\s+(.+?)\s*$/);
    if (m && m[2]) {
      // 遇到新标题：先 flush 前一段
      flush();
      currentHeading = m[2].trim().replace(/\s+/g, ' ');
      continue;
    }
    currentBody.push(line);
  }
  flush();

  return sections.length > 0 ? sections : [{ body: text }];
}

function extractKeywords(text: string, maxKeywords: number): string[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];

  const freq = new Map<string, number>();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) || 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([t]) => t);
}

function pickString(source: unknown, paths: string[]): string {
  for (const path of paths) {
    const v = getPathValue(source, path);
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function getPathValue(source: unknown, path: string): unknown {
  if (!source || typeof source !== 'object') return undefined;
  const parts = path.split('.');
  let cur: any = source;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}
