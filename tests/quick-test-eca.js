
async function testAnalyze() {
  console.log('Testing analyze-edit-intent API...');
  try {
    const response = await fetch('http://localhost:3000/api/analyze-edit-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Change the hero section background to blue',
        manifest: {
          files: {
            'src/components/Hero.jsx': {
              componentInfo: { name: 'Hero', childComponents: [] }
            }
          }
        },
        model: 'gemini-3-pro-preview'
      })
    });

    console.log('Status:', response.status);
    const data = await response.json();
    console.log('Response Data:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

testAnalyze();
