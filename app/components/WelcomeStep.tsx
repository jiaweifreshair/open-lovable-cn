import { ArrowRight } from 'lucide-react';

export default function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      <h1 className="text-3xl font-bold mb-6">情绪小帮手</h1>
      <p className="text-lg mb-8 max-w-md">
        这是一个为同学们设计的情绪树洞应用，帮助你记录每天的心情，
        并获得温暖的安慰和建议。只需3分钟，让我们一起开始吧！
      </p>
      <div className="mb-8 p-6 bg-blue-50 rounded-lg text-left">
        <h2 className="font-bold mb-2">使用方法：</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>选择你当前的心情</li>
          <li>简单描述你的烦恼</li>
          <li>获取温暖的鼓励和建议</li>
        </ol>
      </div>
      <button
        onClick={onNext}
        className="flex items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        开始使用 <ArrowRight className="ml-2" size={18} />
      </button>
    </div>
  );
}