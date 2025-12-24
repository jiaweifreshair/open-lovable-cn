import React from 'react';

export default function TestStylesPage() {
  return (
    <div className="min-h-screen bg-background-base text-accent-black p-10 font-sans">
      <div className="container mx-auto">
        <header className="mb-12 text-center">
          <h1 className="title-h1 mb-4 text-gradient gradient-fire">Style System Verification</h1>
          <p className="body-large text-accent-black/60">
            Checking if Tailwind configuration and CSS imports are working correctly.
          </p>
        </header>

        <section className="mb-16">
          <h2 className="title-h2 mb-6 border-b border-border-muted pb-2">Typography & Colors</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <h3 className="title-h3">Typography Scale</h3>
              <p className="title-h1">Heading 1</p>
              <p className="title-h2">Heading 2</p>
              <p className="title-h3">Heading 3</p>
              <p className="title-h4">Heading 4</p>
              <p className="title-h5">Heading 5</p>
              <p className="body-large">Body Large Text</p>
              <p className="body-medium">Body Medium Text</p>
              <p className="body-small">Body Small Text</p>
              <p className="mono-medium">Monospace Text</p>
            </div>

            <div className="space-y-4">
              <h3 className="title-h3">Brand Colors</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-heat-100 p-4 rounded-lg text-white font-medium shadow-md">Heat 100</div>
                <div className="bg-heat-200 p-4 rounded-lg text-white font-medium shadow-md">Heat 200</div>
                <div className="bg-accent-bluetron p-4 rounded-lg text-white font-medium shadow-md">Bluetron</div>
                <div className="bg-accent-amethyst p-4 rounded-lg text-white font-medium shadow-md">Amethyst</div>
                <div className="bg-accent-crimson p-4 rounded-lg text-white font-medium shadow-md">Crimson</div>
                <div className="bg-accent-black p-4 rounded-lg text-white font-medium shadow-md">Black</div>
              </div>
              
              <h3 className="title-h3 mt-8">Gradients</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="gradient-fire p-4 rounded-lg text-white font-medium h-24 flex items-center justify-center">Fire Gradient</div>
                <div className="gradient-ocean p-4 rounded-lg text-white font-medium h-24 flex items-center justify-center">Ocean Gradient</div>
              </div>
            </div>
          </div>
        </section>

        <section className="mb-16">
          <h2 className="title-h2 mb-6 border-b border-border-muted pb-2">Components</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-6 bg-white rounded-xl shadow-lg border border-border-faint">
              <h3 className="title-h4 mb-4">Cards</h3>
              <p className="body-medium text-black-alpha-64 mb-6">
                This is a standard card using white background and faint border.
              </p>
              <div className="flex gap-2">
                <button className="button button-primary px-6 py-2 rounded-lg text-white font-medium">
                  Primary Button
                </button>
              </div>
            </div>

            <div className="p-6 bg-background-lighter rounded-xl border-gradient">
              <h3 className="title-h4 mb-4">Gradient Border</h3>
              <p className="body-medium text-black-alpha-64 mb-6">
                This card uses the .border-gradient utility class for a fancy border effect.
              </p>
              <span className="dotted-underline font-medium text-heat-100">Interactive Element</span>
            </div>

            <div className="p-6 bg-black text-white rounded-xl shadow-xl heat-glow">
              <h3 className="title-h4 mb-4">Dark Mode / Glow</h3>
              <p className="body-medium text-white-alpha-72 mb-6">
                Testing dark mode colors and the heat-glow animation effect.
              </p>
              <div className="w-full h-2 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-heat-100 w-2/3"></div>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="title-h2 mb-6 border-b border-border-muted pb-2">Tailwind Utilities Check</h2>
          <div className="flex flex-wrap gap-4">
            <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold">Flex</div>
            <div className="w-16 h-16 bg-green-500 rounded-lg transform rotate-12 flex items-center justify-center text-white font-bold">Rotate</div>
            <div className="w-16 h-16 bg-red-500 rounded-full opacity-50 flex items-center justify-center text-white font-bold">Opacity</div>
            <div className="w-16 h-16 border-4 border-yellow-500 rounded-full flex items-center justify-center font-bold">Border</div>
            <div className="px-4 py-2 bg-gray-100 rounded-md shadow-inner flex items-center font-mono">
              p-4 rounded-md shadow-inner
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
