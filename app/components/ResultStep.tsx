const adviceMap: Record<string, string> = {
  happy: "继续保持好心情！快乐是会传染的，把你的快乐分享给身边的人吧~",
  neutral: "平静也是一种美好的状态。不妨做些让自己放松的事情，享受当下。",
  sad: "每个人都会有难过的时刻，这不是你的错。和朋友聊聊天或者听听音乐可能会让你感觉好些。",
  angry: "生气是很正常的情绪，试着深呼吸几次，或者暂时离开让你生气的环境。",
};

export default function ResultStep({ 
  mood, 
  worryText,
  onRestart 
}: { 
  mood: string;
  worryText: string;
  onRestart: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center max-w-md">
      <h2 className="text-2xl font-bold mb-6">给你的小建议</h2>
      <div className="bg-blue-50 p-6 rounded-lg mb-8 w-full">
        <p className="mb-4 text-gray-700">{adviceMap[mood]}</p>
        {worryText && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-sm text-gray-500 mb-2">关于你提到的：</p>
            <p className="text-gray-700 italic">"{worryText}"</p>
          </div>
        )}
      </div>
      <button
        onClick={onRestart}
        className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        重新开始
      </button>
    </div>
  );
}