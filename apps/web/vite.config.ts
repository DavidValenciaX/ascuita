import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, __dirname, '');
    return {
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_MODEL': JSON.stringify(env.GEMINI_MODEL),
        'process.env.MODEL': JSON.stringify(env.MODEL),
        'process.env.DEBUG_MODE': JSON.stringify(env.DEBUG_MODE),
        'process.env.DEBUG': JSON.stringify(env.DEBUG)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
