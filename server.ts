import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Log available environment variables (keys only for security)
  console.log('--- Environment Diagnostics ---');
  console.log('Available Keys:', Object.keys(process.env).filter(key => 
    key.includes('API') || key.includes('KEY') || key.includes('URL')
  ));
  console.log('OPENAI_API_KEY present:', !!process.env.OPENAI_API_KEY);
  console.log('ANTHROPIC_API_KEY present:', !!process.env.ANTHROPIC_API_KEY);
  console.log('-------------------------------');

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.post('/api/extract', async (req, res) => {
    const { provider, model, input, systemInstruction, responseSchema } = req.body;

    // Helper to find keys case-insensitively
    const findKey = (pattern: string) => {
      const key = Object.keys(process.env).find(k => k.toUpperCase().includes(pattern.toUpperCase()));
      return key ? process.env[key] : null;
    };

    try {
      if (provider === 'openai') {
        const apiKey = findKey('OPENAI_API_KEY');
        console.log(`[Debug] OpenAI Key Found: ${!!apiKey} (Starts with: ${apiKey?.substring(0, 4)}...)`);
        
        if (!apiKey || apiKey === 'undefined' || apiKey.length < 10) {
          return res.status(400).json({ 
            error: 'Missing OpenAI API Key. Please add OPENAI_API_KEY to the Secrets/Settings menu in AI Studio and click RESTART in the preview bar.' 
          });
        }
        const openai = new OpenAI({ apiKey });
        const response = await openai.chat.completions.create({
          model: model || 'gpt-4o',
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: typeof input === 'string' ? input : 'Extract from the provided document.' }
          ],
          response_format: { type: 'json_object' },
          temperature: 0,
        });
        return res.json(JSON.parse(response.choices[0].message.content || '{}'));
      }

      if (provider === 'anthropic') {
        const apiKey = findKey('ANTHROPIC_API_KEY');
        console.log(`[Debug] Anthropic Key Found: ${!!apiKey} (Starts with: ${apiKey?.substring(0, 4)}...)`);

        if (!apiKey || apiKey === 'undefined' || apiKey.length < 10) {
          return res.status(400).json({ 
            error: 'Missing Anthropic API Key. Please add ANTHROPIC_API_KEY to the Secrets/Settings menu in AI Studio and click RESTART in the preview bar.' 
          });
        }
        const anthropic = new Anthropic({ apiKey });
        const response = await anthropic.messages.create({
          model: model || 'claude-3-5-sonnet-latest',
          max_tokens: 4096,
          system: systemInstruction,
          messages: [
            { role: 'user', content: typeof input === 'string' ? input : 'Extract from the provided document.' }
          ],
          temperature: 0,
        });
        // Anthropic doesn't have a native JSON mode like OpenAI, so we parse the text
        const content = response.content[0].type === 'text' ? response.content[0].text : '';
        return res.json(JSON.parse(content || '{}'));
      }

      res.status(400).json({ error: 'Invalid provider' });
    } catch (error: any) {
      console.error('Extraction error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
