'use client';

import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { PlanGenerationResponse } from '@/types/generation';

interface TechnicalPlanViewProps {
  /** 方案内容（实时更新） */
  planContent: string;
  /** 是否正在生成方案 */
  isGenerating: boolean;
  /** 方案摘要（生成完成后提供） */
  summary?: PlanGenerationResponse['plan']['summary'];
  /** 建议的文件清单 */
  suggestedManifest?: PlanGenerationResponse['plan']['suggestedManifest'];
  /** 确认方案回调 */
  onConfirm?: (manifest: PlanGenerationResponse['plan']['suggestedManifest']) => void;
  /** 修改方案回调 */
  onEdit?: () => void;
  /** 取消回调 */
  onCancel?: () => void;
}

export default function TechnicalPlanView({
  planContent,
  isGenerating,
  summary,
  suggestedManifest,
  onConfirm,
  onEdit,
  onCancel
}: TechnicalPlanViewProps) {
  const [displayedContent, setDisplayedContent] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const lastLengthRef = useRef(0);

  // 打字机效果：逐字显示内容
  useEffect(() => {
    if (planContent.length > lastLengthRef.current) {
      const newChars = planContent.slice(lastLengthRef.current);
      lastLengthRef.current = planContent.length;

      // 模拟打字机效果（可以调整速度）
      setDisplayedContent(prev => prev + newChars);

      // 自动滚动到底部
      if (contentRef.current) {
        contentRef.current.scrollTop = contentRef.current.scrollHeight;
      }
    }
  }, [planContent]);

  // 重置状态
  useEffect(() => {
    if (!isGenerating && planContent.length === 0) {
      setDisplayedContent('');
      lastLengthRef.current = 0;
    }
  }, [isGenerating, planContent]);

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">技术实现方案</h2>
              <p className="text-sm text-gray-600">
                {isGenerating ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    正在分析需求并制定方案...
                  </span>
                ) : (
                  '方案生成完成'
                )}
              </p>
            </div>
          </div>

          {/* 操作按钮 */}
          {!isGenerating && onConfirm && (
            <div className="flex flex-col gap-3">
              {/* 醒目的确认提示条 */}
              <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0">
                      <svg className="h-6 w-6 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-blue-700 font-medium">
                        ✨ 技术方案已生成完毕，请确认后开始代码生成
                      </p>
                      <p className="text-xs text-blue-600 mt-1">
                        点击右侧按钮确认方案，系统将自动开始生成 {suggestedManifest?.length || 0} 个文件
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => onConfirm(suggestedManifest || [])}
                    className="ml-4 px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-all shadow-md hover:shadow-lg transform hover:scale-105 animate-pulse"
                  >
                    ✓ 确认并开始生成代码
                  </button>
                </div>
              </div>

              {/* 辅助操作按钮 */}
              <div className="flex gap-2 justify-end">
                {onEdit && (
                  <button
                    onClick={onEdit}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    修改方案
                  </button>
                )}
                {onCancel && (
                  <button
                    onClick={onCancel}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    取消
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Summary Cards (生成完成后显示) */}
      {!isGenerating && summary && (
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <div className="grid grid-cols-4 gap-4">
            {/* 技术栈 */}
            <div className="bg-white rounded-lg p-3 border border-gray-200">
              <div className="text-xs text-gray-500 mb-1">技术栈</div>
              <div className="flex flex-wrap gap-1">
                {summary.techStack.map((tech, i) => (
                  <span key={i} className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                    {tech}
                  </span>
                ))}
              </div>
            </div>

            {/* 文件数 */}
            <div className="bg-white rounded-lg p-3 border border-gray-200">
              <div className="text-xs text-gray-500 mb-1">预计文件</div>
              <div className="text-2xl font-bold text-gray-900">{summary.totalFiles}</div>
              <div className="text-xs text-gray-600">个文件</div>
            </div>

            {/* 预估时间 */}
            <div className="bg-white rounded-lg p-3 border border-gray-200">
              <div className="text-xs text-gray-500 mb-1">预计时间</div>
              <div className="text-2xl font-bold text-gray-900">{summary.estimatedTime}</div>
              <div className="text-xs text-gray-600">分钟</div>
            </div>

            {/* 风险点 */}
            <div className="bg-white rounded-lg p-3 border border-gray-200">
              <div className="text-xs text-gray-500 mb-1">风险点</div>
              <div className="text-2xl font-bold text-orange-600">{summary.risks.length}</div>
              <div className="text-xs text-gray-600">需注意</div>
            </div>
          </div>

          {/* 风险详情 */}
          {summary.risks.length > 0 && (
            <div className="mt-3 bg-orange-50 border border-orange-200 rounded-lg p-3">
              <div className="text-xs font-medium text-orange-800 mb-2">⚠️ 风险提示</div>
              <ul className="space-y-1">
                {summary.risks.map((risk, i) => (
                  <li key={i} className="text-xs text-orange-700 flex items-start gap-2">
                    <span className="text-orange-500 mt-0.5">•</span>
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Plan Content (Markdown with Typewriter Effect) */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto px-6 py-4"
      >
        {displayedContent ? (
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown
              components={{
                // 代码块高亮
                code({ node, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || '');
                  const inline = (props as any).inline;
                  return !inline && match ? (
                    <SyntaxHighlighter
                      style={vscDarkPlus as any}
                      language={match[1]}
                      PreTag="div"
                      {...props}
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                  ) : (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                },
                // 标题样式
                h1: ({ children }) => <h1 className="text-2xl font-bold text-gray-900 mt-6 mb-4">{children}</h1>,
                h2: ({ children }) => <h2 className="text-xl font-semibold text-gray-800 mt-5 mb-3">{children}</h2>,
                h3: ({ children }) => <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">{children}</h3>,
                // 列表样式
                ul: ({ children }) => <ul className="list-disc list-inside space-y-1 my-2">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 my-2">{children}</ol>,
                li: ({ children }) => <li className="text-gray-700">{children}</li>,
                // 段落样式
                p: ({ children }) => <p className="text-gray-700 leading-relaxed my-2">{children}</p>,
                // 链接样式
                a: ({ children, href }) => (
                  <a href={href} className="text-blue-600 hover:text-blue-700 underline" target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
                // 引用样式
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-blue-500 pl-4 py-2 my-3 bg-blue-50 text-gray-700">
                    {children}
                  </blockquote>
                ),
              }}
            >
              {displayedContent}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm">等待技术方案生成...</p>
            </div>
          </div>
        )}

        {/* 打字机光标效果 */}
        {isGenerating && displayedContent && (
          <span className="inline-block w-2 h-4 bg-blue-600 animate-pulse ml-1" />
        )}
      </div>
    </div>
  );
}
