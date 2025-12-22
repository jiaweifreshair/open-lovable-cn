export default function ProgressBar({ step }: { step: number }) {
  return (
    <div className="w-full bg-gray-200 rounded-full h-2.5 mb-8">
      <div 
        className="bg-blue-600 h-2.5 rounded-full transition-all duration-500" 
        style={{ width: `${(step / 4) * 100}%` }}
      ></div>
    </div>
  );
}