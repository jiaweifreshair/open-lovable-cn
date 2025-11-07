/**
 * 爬虫模块统一导出
 *
 * Phase 3B 升级：新增 Crawlee 智能爬虫
 * 提供简洁的导入接口
 */

export * from './types';
export * from './firecrawl-scraper';
export * from './playwright-scraper';
export * from './crawlee-scraper'; // Phase 3B 新增
export * from './scraper-router';

// 默认导出智能路由器
export { createScraperRouter as default } from './scraper-router';
