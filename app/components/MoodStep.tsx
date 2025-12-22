import { Smile, Frown, Meh, Angry } from 'lucide-react';
import EmojiButton from './EmojiButton';

const moods = [
  { icon: Smile, label: '开心', value: 'happy' },
  { icon: Meh, label: '一般', value: 'neutral' },
  { icon: Frown, label: '难过', value: 'sad' },
  { icon: Angry, label: '生气', value: 'angry' },
];

export default function MoodStep({ 
  selectedMood, 
  onSelect, 
  onNext 
}: { 
  selectedMood: string | null;
  onSelect: (mood: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <h2 className="text-2xl font-bold mb-8">你今天感觉如何？</h2>
      <div className="grid grid-cols-2 gap-4 mb-8">
        {moods.map((mood) => (
          <EmojiButton
            key={mood.value}
            icon={mood.icon}
            label={mood.label}
            selected={selectedMood === mood.value}
            onClick={() => onSelect(mood.value)}
          />
        ))}
      </div>
      <button
        onClick={onNext}
        disabled={!selectedMood}
        className={`px-6 py-3 rounded-lg transition-colors ${
          selectedMood
            ? 'bg-blue-600 text-white hover:bg-blue-700'
            : 'bg-gray-300 text-gray-500 cursor-not-allowed'
        }`}
      >
        下一步
      </button>
    </div>
  );
}