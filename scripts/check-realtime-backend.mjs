const baseUrl = process.argv[2] || process.env.VITE_API_BASE_URL;
if (!baseUrl) throw new Error('Set VITE_API_BASE_URL before publishing the frontend.');
const deadline = Date.now() + 180_000;
let lastError = 'Compatible backend not available';
while (Date.now() < deadline) {
  try {
    const [configuration, readiness] = await Promise.all([
      fetch(new URL('/live/v2/config', baseUrl), { signal: AbortSignal.timeout(8000) }),
      fetch(new URL('/ready', baseUrl), { signal: AbortSignal.timeout(8000) }),
    ]);
    if (configuration.ok && readiness.ok) {
      const info = await configuration.json();
      const ready = await readiness.json();
      if (['gemini', 'qwen'].includes(info.provider) && info.audio?.inputSampleRate === 16000 && ready.ready === true) {
        console.log('Compatible realtime backend is ready.');
        process.exit(0);
      }
    }
    lastError = `Backend not ready: config ${configuration.status}, readiness ${readiness.status}`;
  } catch { lastError = 'Realtime backend is unreachable'; }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
throw new Error(lastError);
