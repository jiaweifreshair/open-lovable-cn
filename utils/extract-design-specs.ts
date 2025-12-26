/**
 * 视觉设计规格提取工具
 *
 * 目的：
 * - 从抓取的网页中提取视觉设计信息（颜色、字体、背景图片等）
 * - 生成结构化的设计规格，用于指导 AI 精确还原网站视觉
 * - 支持 CSS 变量生成，便于 Tailwind 集成
 *
 * 使用场景：
 * - 克隆网站时，确保视觉保真度
 * - 提取品牌色、主题、排版等关键设计元素
 */

import * as cheerio from 'cheerio';

/**
 * 视觉设计规格接口
 */
export interface DesignSpecs {
  /** 颜色方案 */
  colors: ColorScheme;

  /** 主题类型 */
  theme: 'light' | 'dark' | 'mixed';

  /** 背景图片 */
  backgroundImages: BackgroundImage[];

  /** Hero 区域背景 */
  heroBackground?: HeroBackground;

  /** 字体配置 */
  typography: Typography;

  /** 组件样式 */
  components: ComponentStyles;

  /** CSS 变量（用于 Tailwind 集成） */
  cssVariables: Record<string, string>;

  /** 提取的元数据 */
  metadata: {
    extractedAt: string;
    sourceUrl: string;
    confidence: number;  // 0-1，表示提取的置信度
  };
}

export interface ColorScheme {
  /** 主品牌色 */
  primary: string;
  /** 次要品牌色 */
  secondary: string;
  /** 背景色 */
  background: string;
  /** 表面色（卡片、模态框等） */
  surface: string;
  /** 主文字色 */
  text: string;
  /** 次要文字色 */
  textSecondary: string;
  /** 强调色 */
  accent: string;
  /** 边框色 */
  border: string;
  /** 所有提取的颜色（用于分析） */
  allColors: ExtractedColor[];
}

export interface ExtractedColor {
  value: string;       // hex 值
  count: number;       // 出现次数
  context: string[];   // 使用场景（background, text, border 等）
}

export interface BackgroundImage {
  url: string;
  context: string;     // hero, section, card 等
  selector?: string;   // 原始 CSS 选择器
}

export interface HeroBackground {
  type: 'image' | 'gradient' | 'solid' | 'video';
  imageUrl?: string;
  gradient?: string;
  solidColor?: string;
  overlay?: string;    // 叠加层颜色/渐变
}

export interface Typography {
  /** 标题字体族 */
  headingFamily: string;
  /** 正文字体族 */
  bodyFamily: string;
  /** 标题尺寸 */
  headingSizes: {
    h1: string;
    h2: string;
    h3: string;
    h4: string;
  };
  /** 正文尺寸 */
  bodySize: string;
  /** 行高 */
  lineHeight: string;
  /** 字重 */
  fontWeights: {
    normal: string;
    medium: string;
    bold: string;
  };
}

export interface ComponentStyles {
  /** 卡片圆角 */
  cardBorderRadius: string;
  /** 卡片阴影 */
  cardShadow: string;
  /** 按钮圆角 */
  buttonBorderRadius: string;
  /** 按钮内边距 */
  buttonPadding: string;
  /** 输入框圆角 */
  inputBorderRadius: string;
  /** 通用间距 */
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
}

/**
 * 从 HTML 内容中提取视觉设计规格
 */
export function extractDesignSpecs(params: {
  html: string;
  url: string;
  markdown?: string;
}): DesignSpecs {
  const { html, url, markdown } = params;
  const $ = cheerio.load(html);

  // 1. 提取所有颜色
  const allColors = extractAllColors($, html);

  // 2. 分析颜色方案
  const colors = analyzeColorScheme(allColors);

  // 3. 检测主题
  const theme = detectTheme(colors);

  // 4. 提取背景图片
  const backgroundImages = extractBackgroundImages($, html, url);

  // 5. 分析 Hero 区域
  const heroBackground = analyzeHeroBackground($, html, url);

  // 6. 提取字体配置
  const typography = extractTypography($, html);

  // 7. 提取组件样式
  const components = extractComponentStyles($, html);

  // 8. 生成 CSS 变量
  const cssVariables = generateCssVariables(colors, typography, components);

  // 9. 计算置信度
  const confidence = calculateConfidence(allColors, backgroundImages, typography);

  return {
    colors,
    theme,
    backgroundImages,
    heroBackground,
    typography,
    components,
    cssVariables,
    metadata: {
      extractedAt: new Date().toISOString(),
      sourceUrl: url,
      confidence,
    },
  };
}

/**
 * 从 HTML 和内联样式中提取所有颜色
 */
function extractAllColors($: cheerio.CheerioAPI, html: string): ExtractedColor[] {
  const colorMap = new Map<string, { count: number; context: Set<string> }>();

  // 正则匹配各种颜色格式
  const hexPattern = /#([0-9a-fA-F]{3}){1,2}\b/g;
  const rgbPattern = /rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/gi;
  const rgbaPattern = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)/gi;
  const hslPattern = /hsl\(\s*\d+\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*\)/gi;

  const addColor = (color: string, context: string) => {
    const hex = normalizeToHex(color);
    if (!hex) return;

    const existing = colorMap.get(hex);
    if (existing) {
      existing.count++;
      existing.context.add(context);
    } else {
      colorMap.set(hex, { count: 1, context: new Set([context]) });
    }
  };

  // 从 style 属性提取
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';

    // 背景色
    const bgMatch = style.match(/background(?:-color)?:\s*([^;]+)/i);
    if (bgMatch) {
      const colors = bgMatch[1].match(hexPattern) ||
                     bgMatch[1].match(rgbPattern) ||
                     bgMatch[1].match(rgbaPattern);
      colors?.forEach(c => addColor(c, 'background'));
    }

    // 文字色
    const colorMatch = style.match(/(?:^|[^-])color:\s*([^;]+)/i);
    if (colorMatch) {
      const colors = colorMatch[1].match(hexPattern) ||
                     colorMatch[1].match(rgbPattern);
      colors?.forEach(c => addColor(c, 'text'));
    }

    // 边框色
    const borderMatch = style.match(/border(?:-color)?:\s*([^;]+)/i);
    if (borderMatch) {
      const colors = borderMatch[1].match(hexPattern) ||
                     borderMatch[1].match(rgbPattern);
      colors?.forEach(c => addColor(c, 'border'));
    }
  });

  // 从 <style> 标签和内联 CSS 提取
  const styleContent = $('style').text() + html;

  const allHexColors = styleContent.match(hexPattern) || [];
  const allRgbColors = styleContent.match(rgbPattern) || [];

  allHexColors.forEach(c => addColor(c, 'css'));
  allRgbColors.forEach(c => addColor(c, 'css'));

  // 从 class 名称推断（Tailwind 等）
  const tailwindBgClasses = html.match(/bg-\[#[0-9a-fA-F]{3,6}\]/g) || [];
  tailwindBgClasses.forEach(cls => {
    const match = cls.match(/#[0-9a-fA-F]{3,6}/);
    if (match) addColor(match[0], 'tailwind-bg');
  });

  const tailwindTextClasses = html.match(/text-\[#[0-9a-fA-F]{3,6}\]/g) || [];
  tailwindTextClasses.forEach(cls => {
    const match = cls.match(/#[0-9a-fA-F]{3,6}/);
    if (match) addColor(match[0], 'tailwind-text');
  });

  // 转换为数组并排序
  return Array.from(colorMap.entries())
    .map(([value, data]) => ({
      value,
      count: data.count,
      context: Array.from(data.context),
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 分析颜色方案，识别主要颜色角色
 */
function analyzeColorScheme(allColors: ExtractedColor[]): ColorScheme {
  // 分离背景色和文字色
  const bgColors = allColors.filter(c =>
    c.context.includes('background') || c.context.includes('tailwind-bg')
  );
  const textColors = allColors.filter(c =>
    c.context.includes('text') || c.context.includes('tailwind-text')
  );
  const borderColors = allColors.filter(c => c.context.includes('border'));

  // 计算颜色亮度
  const getLuminance = (hex: string): number => {
    const rgb = hexToRgb(hex);
    if (!rgb) return 0.5;
    return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  };

  // 找出最深和最浅的颜色
  const sortedByLuminance = [...allColors].sort(
    (a, b) => getLuminance(a.value) - getLuminance(b.value)
  );

  const darkestColors = sortedByLuminance.slice(0, 5);
  const lightestColors = sortedByLuminance.slice(-5).reverse();

  // 找出使用最多的颜色作为主色
  const mostUsedColors = [...allColors].sort((a, b) => b.count - a.count);

  // 识别主品牌色（排除黑白灰）
  const brandColors = mostUsedColors.filter(c => {
    const lum = getLuminance(c.value);
    return lum > 0.1 && lum < 0.9 && !isGrayscale(c.value);
  });

  // 默认值
  const defaults = {
    primary: '#3b82f6',      // blue-500
    secondary: '#6366f1',    // indigo-500
    background: '#ffffff',
    surface: '#f9fafb',      // gray-50
    text: '#111827',         // gray-900
    textSecondary: '#6b7280', // gray-500
    accent: '#f59e0b',       // amber-500
    border: '#e5e7eb',       // gray-200
  };

  return {
    primary: brandColors[0]?.value || defaults.primary,
    secondary: brandColors[1]?.value || defaults.secondary,
    background: bgColors.find(c => getLuminance(c.value) > 0.8)?.value ||
                lightestColors[0]?.value || defaults.background,
    surface: bgColors.find(c => {
      const lum = getLuminance(c.value);
      return lum > 0.9 && lum < 0.98;
    })?.value || defaults.surface,
    text: textColors.find(c => getLuminance(c.value) < 0.3)?.value ||
          darkestColors[0]?.value || defaults.text,
    textSecondary: textColors.find(c => {
      const lum = getLuminance(c.value);
      return lum > 0.3 && lum < 0.6;
    })?.value || defaults.textSecondary,
    accent: brandColors[2]?.value || defaults.accent,
    border: borderColors[0]?.value || defaults.border,
    allColors,
  };
}

/**
 * 检测主题类型（深色/浅色/混合）
 */
function detectTheme(colors: ColorScheme): 'light' | 'dark' | 'mixed' {
  const bgLuminance = getLuminanceFromHex(colors.background);
  const textLuminance = getLuminanceFromHex(colors.text);

  // 背景亮度 > 0.7 且 文字亮度 < 0.3 => 浅色主题
  if (bgLuminance > 0.7 && textLuminance < 0.3) {
    return 'light';
  }

  // 背景亮度 < 0.3 且 文字亮度 > 0.7 => 深色主题
  if (bgLuminance < 0.3 && textLuminance > 0.7) {
    return 'dark';
  }

  return 'mixed';
}

/**
 * 提取所有背景图片
 */
function extractBackgroundImages(
  $: cheerio.CheerioAPI,
  html: string,
  baseUrl: string
): BackgroundImage[] {
  const images: BackgroundImage[] = [];
  const seen = new Set<string>();

  const resolveUrl = (url: string): string => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/')) {
      try {
        const base = new URL(baseUrl);
        return `${base.origin}${url}`;
      } catch {
        return url;
      }
    }
    return url;
  };

  // 从 style 属性提取 background-image
  $('[style*="background"]').each((_, el) => {
    const style = $(el).attr('style') || '';
    const urlMatch = style.match(/url\(['"]?([^'")\s]+)['"]?\)/i);
    if (urlMatch && urlMatch[1]) {
      const url = resolveUrl(urlMatch[1]);
      if (url && !seen.has(url) && !url.includes('data:')) {
        seen.add(url);

        // 推断上下文
        const tagName = $(el).prop('tagName')?.toLowerCase();
        const className = $(el).attr('class') || '';
        let context = 'section';

        if (className.match(/hero|banner|header|jumbotron/i) ||
            tagName === 'header' ||
            $(el).find('h1').length > 0) {
          context = 'hero';
        } else if (className.match(/card|tile|item/i)) {
          context = 'card';
        } else if (className.match(/footer/i) || tagName === 'footer') {
          context = 'footer';
        }

        images.push({ url, context, selector: className });
      }
    }
  });

  // 从 <style> 标签提取
  const styleText = $('style').text();
  const bgImageMatches = styleText.matchAll(/background(?:-image)?:\s*url\(['"]?([^'")\s]+)['"]?\)/gi);
  for (const match of bgImageMatches) {
    const url = resolveUrl(match[1]);
    if (url && !seen.has(url) && !url.includes('data:')) {
      seen.add(url);
      images.push({ url, context: 'css' });
    }
  }

  // 从 img 标签提取大图（可能用作背景）
  $('img').each((_, el) => {
    const src = $(el).attr('src');
    const className = $(el).attr('class') || '';
    const style = $(el).attr('style') || '';

    // 检查是否是全宽或大尺寸图片
    if (src && (
      className.match(/hero|banner|background|cover|full/i) ||
      style.match(/width:\s*100%|object-fit:\s*cover/i)
    )) {
      const url = resolveUrl(src);
      if (url && !seen.has(url) && !url.includes('data:')) {
        seen.add(url);
        images.push({ url, context: 'hero-img' });
      }
    }
  });

  return images;
}

/**
 * 分析 Hero 区域背景
 */
function analyzeHeroBackground(
  $: cheerio.CheerioAPI,
  html: string,
  baseUrl: string
): HeroBackground | undefined {
  // 查找 Hero 元素
  const heroSelectors = [
    '[class*="hero"]',
    '[class*="banner"]',
    '[class*="jumbotron"]',
    'header > section:first-child',
    'main > section:first-child',
    'section:first-of-type',
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let heroEl: ReturnType<typeof $> | null = null;

  for (const selector of heroSelectors) {
    const el = $(selector).first();
    if (el.length > 0) {
      heroEl = el;
      break;
    }
  }

  if (!heroEl) {
    // 尝试通过 h1 的父元素找 Hero
    const h1Parent = $('h1').first().parent();
    if (h1Parent.length > 0) {
      heroEl = h1Parent;
    }
  }

  if (!heroEl) return undefined;

  const style = heroEl.attr('style') || '';
  const className = heroEl.attr('class') || '';

  // 检查背景图片
  const bgImageMatch = style.match(/background(?:-image)?:\s*url\(['"]?([^'")\s]+)['"]?\)/i);
  if (bgImageMatch) {
    let imageUrl = bgImageMatch[1];
    if (!imageUrl.startsWith('http')) {
      try {
        const base = new URL(baseUrl);
        imageUrl = imageUrl.startsWith('/')
          ? `${base.origin}${imageUrl}`
          : `${base.origin}/${imageUrl}`;
      } catch {}
    }

    // 检查叠加层
    let overlay: string | undefined;
    const gradientMatch = style.match(/linear-gradient\([^)]+\)/i);
    if (gradientMatch) {
      overlay = gradientMatch[0];
    }

    return {
      type: 'image',
      imageUrl,
      overlay,
    };
  }

  // 检查渐变背景
  const gradientMatch = style.match(/(linear|radial)-gradient\([^)]+\)/i);
  if (gradientMatch) {
    return {
      type: 'gradient',
      gradient: gradientMatch[0],
    };
  }

  // 检查纯色背景
  const bgColorMatch = style.match(/background(?:-color)?:\s*(#[0-9a-fA-F]{3,6}|rgb[a]?\([^)]+\))/i);
  if (bgColorMatch) {
    return {
      type: 'solid',
      solidColor: normalizeToHex(bgColorMatch[1]) || bgColorMatch[1],
    };
  }

  // 检查深色 Tailwind 类
  if (className.match(/bg-(gray|slate|zinc|neutral|stone)-(800|900|950)/)) {
    return {
      type: 'solid',
      solidColor: '#1f2937', // gray-800 近似值
    };
  }

  // V2.1: 检查 Hero 区域内的 <img> 标签（用于 banner/hero image）
  // 这对于像 jet-bay.com 这样使用 <img> 而非 CSS background 的网站很重要
  const heroImg = heroEl.find('img').first();
  if (heroImg.length > 0) {
    let imgSrc = heroImg.attr('src') || '';
    // 处理 Next.js 图片优化 URL
    if (imgSrc.includes('/_next/image')) {
      const urlMatch = imgSrc.match(/url=([^&]+)/);
      if (urlMatch) {
        imgSrc = decodeURIComponent(urlMatch[1]);
      }
    }
    // 确保是完整 URL
    if (imgSrc && !imgSrc.startsWith('http')) {
      try {
        const base = new URL(baseUrl);
        imgSrc = imgSrc.startsWith('/')
          ? `${base.origin}${imgSrc}`
          : `${base.origin}/${imgSrc}`;
      } catch {}
    }
    if (imgSrc) {
      return {
        type: 'image',
        imageUrl: imgSrc,
        // 标记这是 img 标签而非 CSS background
        overlay: '/* Note: This is an <img> tag, not CSS background */',
      };
    }
  }

  return undefined;
}

/**
 * 提取字体配置
 */
function extractTypography($: cheerio.CheerioAPI, html: string): Typography {
  const defaults: Typography = {
    headingFamily: 'Inter, system-ui, sans-serif',
    bodyFamily: 'Inter, system-ui, sans-serif',
    headingSizes: {
      h1: '3rem',    // 48px
      h2: '2.25rem', // 36px
      h3: '1.5rem',  // 24px
      h4: '1.25rem', // 20px
    },
    bodySize: '1rem',
    lineHeight: '1.5',
    fontWeights: {
      normal: '400',
      medium: '500',
      bold: '700',
    },
  };

  // 从 <style> 提取字体族
  const styleText = $('style').text();
  const fontFamilyMatch = styleText.match(/font-family:\s*([^;]+)/i);
  if (fontFamilyMatch) {
    defaults.bodyFamily = fontFamilyMatch[1].trim();
  }

  // 从 body 样式提取
  const bodyStyle = $('body').attr('style') || '';
  const bodyFontMatch = bodyStyle.match(/font-family:\s*([^;]+)/i);
  if (bodyFontMatch) {
    defaults.bodyFamily = bodyFontMatch[1].trim();
  }

  // 从 h1 提取标题字体
  const h1 = $('h1').first();
  const h1Style = h1.attr('style') || '';
  const h1FontMatch = h1Style.match(/font-family:\s*([^;]+)/i);
  if (h1FontMatch) {
    defaults.headingFamily = h1FontMatch[1].trim();
  }

  // 提取 h1 字体大小
  const h1SizeMatch = h1Style.match(/font-size:\s*([^;]+)/i);
  if (h1SizeMatch) {
    defaults.headingSizes.h1 = h1SizeMatch[1].trim();
  }

  // 检查 Tailwind 字体类
  const h1Class = h1.attr('class') || '';
  const textSizeMatch = h1Class.match(/text-(\d+)?xl/);
  if (textSizeMatch) {
    const sizeMap: Record<string, string> = {
      'xl': '1.25rem',
      '2xl': '1.5rem',
      '3xl': '1.875rem',
      '4xl': '2.25rem',
      '5xl': '3rem',
      '6xl': '3.75rem',
      '7xl': '4.5rem',
      '8xl': '6rem',
      '9xl': '8rem',
    };
    const key = textSizeMatch[0].replace('text-', '');
    if (sizeMap[key]) {
      defaults.headingSizes.h1 = sizeMap[key];
    }
  }

  return defaults;
}

/**
 * 提取组件样式
 */
function extractComponentStyles($: cheerio.CheerioAPI, html: string): ComponentStyles {
  const defaults: ComponentStyles = {
    cardBorderRadius: '0.5rem',  // rounded-lg
    cardShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    buttonBorderRadius: '0.375rem', // rounded-md
    buttonPadding: '0.5rem 1rem',
    inputBorderRadius: '0.375rem',
    spacing: {
      xs: '0.25rem',
      sm: '0.5rem',
      md: '1rem',
      lg: '1.5rem',
      xl: '2rem',
    },
  };

  // 查找卡片元素
  const card = $('[class*="card"], [class*="Card"]').first();
  if (card.length > 0) {
    const style = card.attr('style') || '';
    const className = card.attr('class') || '';

    // 提取圆角
    const radiusMatch = style.match(/border-radius:\s*([^;]+)/i);
    if (radiusMatch) {
      defaults.cardBorderRadius = radiusMatch[1].trim();
    }

    // 从 Tailwind 类推断
    if (className.match(/rounded-xl/)) defaults.cardBorderRadius = '0.75rem';
    else if (className.match(/rounded-2xl/)) defaults.cardBorderRadius = '1rem';
    else if (className.match(/rounded-3xl/)) defaults.cardBorderRadius = '1.5rem';

    // 提取阴影
    const shadowMatch = style.match(/box-shadow:\s*([^;]+)/i);
    if (shadowMatch) {
      defaults.cardShadow = shadowMatch[1].trim();
    }
  }

  // 查找按钮元素
  const button = $('button, [class*="btn"], [class*="Button"]').first();
  if (button.length > 0) {
    const style = button.attr('style') || '';
    const className = button.attr('class') || '';

    const radiusMatch = style.match(/border-radius:\s*([^;]+)/i);
    if (radiusMatch) {
      defaults.buttonBorderRadius = radiusMatch[1].trim();
    }

    // 从 Tailwind 类推断
    if (className.match(/rounded-full/)) defaults.buttonBorderRadius = '9999px';
    else if (className.match(/rounded-lg/)) defaults.buttonBorderRadius = '0.5rem';
  }

  return defaults;
}

/**
 * 生成 CSS 变量（用于 Tailwind 集成）
 */
function generateCssVariables(
  colors: ColorScheme,
  typography: Typography,
  components: ComponentStyles
): Record<string, string> {
  return {
    // 颜色变量
    '--color-primary': colors.primary,
    '--color-secondary': colors.secondary,
    '--color-background': colors.background,
    '--color-surface': colors.surface,
    '--color-text': colors.text,
    '--color-text-secondary': colors.textSecondary,
    '--color-accent': colors.accent,
    '--color-border': colors.border,

    // 字体变量
    '--font-heading': typography.headingFamily,
    '--font-body': typography.bodyFamily,
    '--font-size-h1': typography.headingSizes.h1,
    '--font-size-h2': typography.headingSizes.h2,
    '--font-size-h3': typography.headingSizes.h3,
    '--font-size-body': typography.bodySize,
    '--line-height': typography.lineHeight,

    // 组件变量
    '--radius-card': components.cardBorderRadius,
    '--radius-button': components.buttonBorderRadius,
    '--radius-input': components.inputBorderRadius,
    '--shadow-card': components.cardShadow,

    // 间距变量
    '--spacing-xs': components.spacing.xs,
    '--spacing-sm': components.spacing.sm,
    '--spacing-md': components.spacing.md,
    '--spacing-lg': components.spacing.lg,
    '--spacing-xl': components.spacing.xl,
  };
}

/**
 * 计算提取置信度
 */
function calculateConfidence(
  allColors: ExtractedColor[],
  backgroundImages: BackgroundImage[],
  typography: Typography
): number {
  let score = 0;

  // 颜色提取质量
  if (allColors.length >= 5) score += 0.3;
  else if (allColors.length >= 3) score += 0.2;
  else if (allColors.length >= 1) score += 0.1;

  // 有品牌色（非灰度）
  const brandColors = allColors.filter(c => !isGrayscale(c.value));
  if (brandColors.length >= 2) score += 0.2;
  else if (brandColors.length >= 1) score += 0.1;

  // 背景图片
  if (backgroundImages.length > 0) score += 0.2;

  // 字体信息
  if (typography.headingFamily !== 'Inter, system-ui, sans-serif') score += 0.15;
  if (typography.headingSizes.h1 !== '3rem') score += 0.15;

  return Math.min(score, 1);
}

// ============ 工具函数 ============

/**
 * 将各种颜色格式转换为 hex
 */
function normalizeToHex(color: string): string | null {
  if (!color) return null;

  color = color.trim().toLowerCase();

  // 已经是 hex
  if (color.startsWith('#')) {
    if (color.length === 4) {
      // #rgb -> #rrggbb
      return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
    }
    return color;
  }

  // rgb(r, g, b)
  const rgbMatch = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  // rgba(r, g, b, a)
  const rgbaMatch = color.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[\d.]+\s*\)/i);
  if (rgbaMatch) {
    const r = parseInt(rgbaMatch[1], 10);
    const g = parseInt(rgbaMatch[2], 10);
    const b = parseInt(rgbaMatch[3], 10);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  return null;
}

/**
 * hex 转 RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!hex) return null;

  hex = hex.replace('#', '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : null;
}

/**
 * 计算颜色亮度
 */
function getLuminanceFromHex(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

/**
 * 检查是否为灰度色
 */
function isGrayscale(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;

  const threshold = 15;
  return Math.abs(rgb.r - rgb.g) < threshold &&
         Math.abs(rgb.g - rgb.b) < threshold &&
         Math.abs(rgb.r - rgb.b) < threshold;
}

/**
 * 格式化设计规格为 Prompt 注入格式
 */
export function formatDesignSpecsForPrompt(specs: DesignSpecs): string {
  const lines: string[] = [
    '=== VISUAL DESIGN SPECIFICATIONS (MUST FOLLOW EXACTLY) ===',
    '',
    '## Color Scheme',
    `- Primary Brand Color: ${specs.colors.primary}`,
    `- Secondary Color: ${specs.colors.secondary}`,
    `- Background Color: ${specs.colors.background}`,
    `- Surface Color: ${specs.colors.surface}`,
    `- Text Color: ${specs.colors.text}`,
    `- Secondary Text: ${specs.colors.textSecondary}`,
    `- Accent Color: ${specs.colors.accent}`,
    `- Border Color: ${specs.colors.border}`,
    '',
    `## Theme: ${specs.theme.toUpperCase()}`,
    specs.theme === 'dark'
      ? '- Use dark backgrounds (gray-900, slate-900) and light text'
      : specs.theme === 'light'
        ? '- Use light backgrounds (white, gray-50) and dark text'
        : '- Mixed theme - analyze sections individually',
    '',
  ];

  // Hero 背景
  if (specs.heroBackground) {
    lines.push('## Hero Background');
    if (specs.heroBackground.type === 'image' && specs.heroBackground.imageUrl) {
      lines.push(`- Type: Background Image`);
      lines.push(`- Image URL: ${specs.heroBackground.imageUrl}`);
      lines.push(`- MUST use: style={{ backgroundImage: 'url(${specs.heroBackground.imageUrl})', backgroundSize: 'cover', backgroundPosition: 'center' }}`);
      if (specs.heroBackground.overlay) {
        lines.push(`- Overlay: ${specs.heroBackground.overlay}`);
      }
    } else if (specs.heroBackground.type === 'gradient') {
      lines.push(`- Type: Gradient`);
      lines.push(`- Value: ${specs.heroBackground.gradient}`);
    } else if (specs.heroBackground.type === 'solid') {
      lines.push(`- Type: Solid Color`);
      lines.push(`- Color: ${specs.heroBackground.solidColor}`);
    }
    lines.push('');
  }

  // 背景图片列表
  if (specs.backgroundImages.length > 0) {
    lines.push('## Background Images Available');
    specs.backgroundImages.slice(0, 5).forEach((img, i) => {
      lines.push(`${i + 1}. [${img.context}] ${img.url}`);
    });
    lines.push('');
  }

  // 字体
  lines.push('## Typography');
  lines.push(`- Heading Font: ${specs.typography.headingFamily}`);
  lines.push(`- Body Font: ${specs.typography.bodyFamily}`);
  lines.push(`- H1 Size: ${specs.typography.headingSizes.h1} (use text-5xl or text-6xl)`);
  lines.push(`- H2 Size: ${specs.typography.headingSizes.h2}`);
  lines.push('');

  // 组件样式
  lines.push('## Component Styles');
  lines.push(`- Card Border Radius: ${specs.components.cardBorderRadius}`);
  lines.push(`- Button Border Radius: ${specs.components.buttonBorderRadius}`);
  lines.push(`- Card Shadow: Use shadow-lg or shadow-xl`);
  lines.push('');

  // CSS 变量
  lines.push('## CSS Variables (add to index.css :root)');
  lines.push('```css');
  lines.push(':root {');
  Object.entries(specs.cssVariables).forEach(([key, value]) => {
    lines.push(`  ${key}: ${value};`);
  });
  lines.push('}');
  lines.push('```');
  lines.push('');

  // 使用说明
  lines.push('## Usage Instructions');
  lines.push('1. Use CSS variables in Tailwind: bg-[var(--color-primary)]');
  lines.push('2. Or use arbitrary values directly: bg-[' + specs.colors.primary + ']');
  lines.push('3. For Hero with image: Add inline style for backgroundImage');
  lines.push('4. Match the original theme (dark/light) EXACTLY');
  lines.push('');
  lines.push(`## Confidence: ${Math.round(specs.metadata.confidence * 100)}%`);

  return lines.join('\n');
}

/**
 * 生成 Tailwind 配置扩展（用于 index.css）
 */
export function generateTailwindExtendConfig(specs: DesignSpecs): string {
  return `/*
 * 品牌色 CSS 变量 - 从原网站提取
 * 使用方式: bg-[var(--color-primary)] 或 text-[var(--color-primary)]
 */
:root {
  --color-primary: ${specs.colors.primary};
  --color-secondary: ${specs.colors.secondary};
  --color-background: ${specs.colors.background};
  --color-surface: ${specs.colors.surface};
  --color-text: ${specs.colors.text};
  --color-text-secondary: ${specs.colors.textSecondary};
  --color-accent: ${specs.colors.accent};
  --color-border: ${specs.colors.border};

  --font-heading: ${specs.typography.headingFamily};
  --font-body: ${specs.typography.bodyFamily};

  --radius-card: ${specs.components.cardBorderRadius};
  --radius-button: ${specs.components.buttonBorderRadius};
}

/* 深色主题支持 */
.dark {
  --color-background: ${specs.theme === 'dark' ? specs.colors.background : '#1f2937'};
  --color-surface: ${specs.theme === 'dark' ? specs.colors.surface : '#374151'};
  --color-text: ${specs.theme === 'dark' ? specs.colors.text : '#f9fafb'};
  --color-text-secondary: ${specs.theme === 'dark' ? specs.colors.textSecondary : '#9ca3af'};
  --color-border: ${specs.theme === 'dark' ? specs.colors.border : '#4b5563'};
}
`;
}
