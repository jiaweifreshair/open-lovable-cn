import { useState } from 'react';

export default function WorryStep({ 
  onNext, 
  onTextChange 
}: { 
  onNext: () => void;
  onTextChange: (text: string) => void;
}) {
  const [text, setText] = useState('');

  return (
    <div className="flex flex-col items-center w-full max-w-md">
      <h2 className="text-2xl font-bold mb-6">有什么想倾诉的吗？</h2>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onTextChange(e.target.value);
        }}
        placeholder="比如：考试前很紧张，担心考不好..."
        className="w-full h-40 p-4 mb-6 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      <button
        onClick={onNext}
        disabled={!text.trim()}
        className={`px-6 py-3 rounded-lg transition-colors ${
          text.trim()
            ? 'bg-blue-600 text-white hover:bg-blue-700'
            : 'bg-gray-300 text-gray-500 cursor-not-allowed'
        }`}
      >
        获取建议
      </button>
    </div>
  );
}