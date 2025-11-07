/**
 * 爬虫模块统一导出
 * 
 * 提供简洁的导入接口
 */

export * from './types';
export * from './firecrawl-scraper';
export * from './playwright-scraper';
export * from './scraper-router';

// 默认导出智能路由器
export { createScraperRouter as default } from './scraper-router';
