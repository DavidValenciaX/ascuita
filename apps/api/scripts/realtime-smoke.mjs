// Opt-in provider test. Unlike /ready, this makes a billable model request.
// Build first, then: node --env-file=apps/api/.env apps/api/scripts/realtime-smoke.mjs gemini
import { getConfig, realtimeConfigurationErrors, realtimeSessionInfo } from '../dist/config.js';
import { createRealtimeSession } from '../dist/realtime/factory.js';

const config = getConfig();
const provider = process.argv[2] || config.realtimeProvider;
if (!['gemini', 'qwen'].includes(provider)) throw new Error('Usage: realtime-smoke.mjs [gemini|qwen]');
const errors = realtimeConfigurationErrors(config, provider);
if (errors.length) throw new Error(errors.join('; '));
const info = realtimeSessionInfo(config, provider);
let audioChunks = 0;
let finalTranscripts = 0;
let readyAt;
let firstAudioAt;
let session;
let timeout;
const started = Date.now();
try {
  await new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Realtime smoke test timed out')), 30_000);
    session = createRealtimeSession(config, info, { onEvent: event => {
      if (event.type === 'session.ready') {
        readyAt = Date.now();
        void session.sendText('Di brevemente: prueba de audio completada.').catch(reject);
      } else if (event.type === 'audio') {
        audioChunks += 1;
        firstAudioAt ??= Date.now();
      } else if (event.type === 'transcript.final') finalTranscripts += 1;
      else if (event.type === 'error') reject(new Error(event.payload.message));
      else if (event.type === 'close') reject(new Error(event.payload.reason));
      else if (event.type === 'turn.complete') {
        if (audioChunks && finalTranscripts) resolve();
        else reject(new Error('The model did not return both audio and a final transcript'));
      }
    } });
    void session.connect({ agentId: 'smoke-test', config: {
      instructions: 'Eres un asistente de prueba. Habla español y responde en una sola frase corta.',
      voice: 'Aoede', webSearch: false, tools: [],
    } }).catch(reject);
  });
  console.log(JSON.stringify({ passed: true, provider, model: info.model, audioChunks, finalTranscripts,
    setupMs: readyAt - started, firstAudioMs: firstAudioAt - started }));
} finally {
  clearTimeout(timeout);
  session?.close();
}
