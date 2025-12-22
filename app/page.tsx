'use client';

import { useState } from 'react';
import ProgressBar from './components/ProgressBar';
import WelcomeStep from './components/WelcomeStep';
import MoodStep from './components/MoodStep';
import WorryStep from './components/WorryStep';
import ResultStep from './components/ResultStep';

export default function MoodHelper() {
  const [step, setStep] = useState(1);
  const [mood, setMood] = useState<string | null>(null);
  const [worryText, setWorryText] = useState('');

  const handleNext = () => setStep(step + 1);
  const handleRestart = () => {
    setStep(1);
    setMood(null);
    setWorryText('');
  };

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-md p-8">
        <ProgressBar step={step} />
        
        {step === 1 && <WelcomeStep onNext={handleNext} />}
        {step === 2 && (
          <MoodStep 
            selectedMood={mood} 
            onSelect={setMood} 
            onNext={handleNext} 
          />
        )}
        {step === 3 && (
          <WorryStep 
            onNext={handleNext} 
            onTextChange={setWorryText} 
          />
        )}
        {step === 4 && (
          <ResultStep 
            mood={mood || 'neutral'} 
            worryText={worryText} 
            onRestart={handleRestart} 
          />
        )}
      </div>
    </main>
  );
}