import { LucideIcon } from 'lucide-react';

interface EmojiButtonProps {
  icon: LucideIcon;
  label: string;
  selected: boolean;
  onClick: () => void;
}

export default function EmojiButton({ 
  icon: Icon, 
  label, 
  selected, 
  onClick 
}: EmojiButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center p-4 rounded-lg transition-all ${
        selected ? 'bg-blue-100 border-2 border-blue-500' : 'bg-gray-100 border-2 border-transparent'
      } hover:bg-blue-50`}
    >
      <Icon className="w-12 h-12 mb-2" />
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}