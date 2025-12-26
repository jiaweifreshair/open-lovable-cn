import type { Metadata } from 'next';
import '../styles/main.css';

// 说明：避免在构建阶段从 Google Fonts 拉取字体资源（受限网络/沙箱会失败），这里改为使用系统字体栈。
// Tailwind 配置里 `var(--font-inter, var(--font-sans))` 会自动回退到系统字体，无需额外处理。

export const metadata: Metadata = {
  title: 'Lovable中文',
  description: 'AI驱动的网站克隆工具，秒级重新构想任何网站',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
