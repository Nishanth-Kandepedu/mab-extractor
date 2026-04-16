import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory job store (Note: This will reset on server restart)
const jobs = new Map<string, {
  status: 'pending' | 'completed' | 'failed';
  result?: any;
  error?: string;
  startTime: number;
}>();

// Cleanup old jobs every hour
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  for (const [id, job] of jobs.entries()) {
    if (job.startTime < oneHourAgo) {
      jobs.delete(id);
    }
  }
}, 3600000);

/**
 * Robustly extracts JSON from a string that might contain Markdown code blocks or extra text.
 */
function extractJson(text: string): any {
  // Try direct parsing first
  try {
    return JSON.parse(text);
  } catch (e) {
    // Try to find JSON block in markdown
    const match = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1].trim());
      } catch (e2) {
        // Continue to fallback
      }
    }

    // Fallback: find the first '{' and last '}'
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const candidate = text.substring(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch (e3) {
        // Continue to error
      }
    }
    
    console.error("Failed to parse AI response:", text);
    console.error("Text length:", text.length);
    console.error("First 100 chars:", text.substring(0, 100));
    console.error("Last 100 chars:", text.substring(text.length - 100));
    throw new Error("Could not find valid JSON in response");
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Trust proxy for Railway/Cloud Run
  app.set('trust proxy', 1);
  
  // Enable CORS for all origins
  app.use(cors());

  // Log available environment variables (keys only for security)
  console.log('--- Environment Diagnostics ---');
  console.log('Available Keys:', Object.keys(process.env).filter(key => 
    key.includes('API') || key.includes('KEY') || key.includes('URL')
  ));
  console.log('OPENAI_API_KEY present:', !!process.env.OPENAI_API_KEY);
  console.log('ANTHROPIC_API_KEY present:', !!process.env.ANTHROPIC_API_KEY);
  console.log('-------------------------------');

  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // Force HTTPS and security headers in production
  if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
      // Set HSTS header to force HTTPS for 1 year
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
      
      // Railway and most proxies use x-forwarded-proto
      const proto = req.headers['x-forwarded-proto'];
      if (proto && proto !== 'https') {
        return res.redirect(301, `https://${req.headers.host}${req.url}`);
      }
      next();
    });
  }

  // API Routes
  app.use('/api', (req, res, next) => {
    console.log(`[API Debug] ${req.method} ${req.url} - Host: ${req.headers.host}, Origin: ${req.headers.origin}, IP: ${req.ip}`);
    next();
  });

  app.post('/api/extract', async (req, res) => {
    console.log(`[API] POST /api/extract - Host: ${req.headers.host}, Origin: ${req.headers.origin}, Body size: ${JSON.stringify(req.body).length} bytes`);
    const { provider, model, input, systemInstruction, responseSchema, thinkingLevel, test } = req.body;
    if (test) {
      console.log(`[API] Test request received from ${req.headers.origin}`);
      return res.json({ jobId: 'test-job', status: 'completed', result: { status: 'ok' } });
    }
    
    if (!input || (typeof input === 'string' && input.trim().length === 0)) {
      return res.status(400).json({ error: "Input text is required for extraction." });
    }
    const inputSize = typeof input === 'string' ? input.length : (input.data ? input.data.length : 0);
    if (inputSize > 50000000) { // 50MB limit on server
      return res.status(413).json({ error: "Payload too large (max 50MB). Please select a smaller portion of the document." });
    }
    const jobId = Math.random().toString(36).substring(7);

    // Helper to find keys case-insensitively
    const findKey = (pattern: string) => {
      const key = Object.keys(process.env).find(k => k.toUpperCase().includes(pattern.toUpperCase()));
      if (key) {
        const val = process.env[key];
        console.log(`[Debug] Found key ${key} (Length: ${val?.length})`);
        return val;
      }
      return null;
    };

    // Initialize job
    jobs.set(jobId, { status: 'pending', startTime: Date.now() });

    // Start extraction in background
    (async () => {
      try {
        console.log(`[Job ${jobId}] Starting ${provider} extraction using model ${model}...`);
        const startTime = Date.now();

        if (provider === 'gemini') {
          const apiKey = findKey('GEMINI_API_KEY');
          if (!apiKey || apiKey === 'undefined' || apiKey.length < 10) {
            throw new Error('Missing Gemini API Key. Please add GEMINI_API_KEY to the Secrets/Settings menu in AI Studio.');
          }

          const ai = new GoogleGenAI({ apiKey });
          const response = await ai.models.generateContent({
            model: model || 'gemini-2.0-flash',
            contents: typeof input === 'string' ? [{ parts: [{ text: input }] }] : input,
            config: {
              systemInstruction,
              temperature: 0,
              thinkingConfig: model?.includes('thinking') ? { thinkingLevel: thinkingLevel === 'HIGH' ? ThinkingLevel.HIGH : thinkingLevel === 'LOW' ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL } : undefined,
              maxOutputTokens: 65536,
              responseMimeType: "application/json",
              responseSchema: responseSchema,
            },
          });

          const text = response.text;
          const usage = response.usageMetadata;
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[Job ${jobId}] Gemini completed in ${duration}s. Text length: ${text?.length}`);
          console.log(`[Job ${jobId}] Raw Usage Metadata:`, JSON.stringify(usage, null, 2));

          if (!text) {
            throw new Error("Empty response from Gemini API");
          }
          
          const result = extractJson(text);
          result.modelUsed = model || 'gemini-2.0-flash';
          
          if (usage) {
            result.usageMetadata = {
              promptTokenCount: usage.promptTokenCount,
              candidatesTokenCount: usage.candidatesTokenCount,
              thinkingTokenCount: (usage as any).thinkingTokenCount,
              cachedContentTokenCount: (usage as any).cachedContentTokenCount,
              totalTokenCount: usage.totalTokenCount
            };
          }
          
          jobs.set(jobId, { ...jobs.get(jobId)!, status: 'completed', result });
          return;
        }

        if (provider === 'openai') {
          const apiKey = findKey('OPENAI_API_KEY');
          if (!apiKey || apiKey === 'undefined' || apiKey.length < 10) {
            throw new Error('Missing OpenAI API Key.');
          }
          const openai = new OpenAI({ apiKey });
          const response = await openai.chat.completions.create({
            model: model || 'o1',
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: typeof input === 'string' ? input : 'Extract from the provided document.' }
            ],
            response_format: { type: 'json_object' },
            temperature: 0,
            max_tokens: 4096,
          });
          const content = response.choices[0].message.content || '{}';
          const usage = response.usage;
          const result = extractJson(content);
          result.modelUsed = model || 'o1';
          
          if (usage) {
            result.usageMetadata = {
              promptTokenCount: usage.prompt_tokens,
              candidatesTokenCount: usage.completion_tokens,
              totalTokenCount: usage.total_tokens
            };
          }
          
          jobs.set(jobId, { ...jobs.get(jobId)!, status: 'completed', result });
          return;
        }

        if (provider === 'anthropic') {
          const apiKey = findKey('ANTHROPIC_API_KEY');
          if (!apiKey || apiKey === 'undefined' || apiKey.length < 10) {
            throw new Error('Missing Anthropic API Key.');
          }
          const anthropic = new Anthropic({ apiKey });
          const response = await anthropic.messages.create({
            model: model || 'claude-3-7-sonnet-latest',
            max_tokens: 4096,
            system: systemInstruction,
            messages: [
              { role: 'user', content: typeof input === 'string' ? input : 'Extract from the provided document.' }
            ],
            temperature: 0,
          });
          const content = response.content[0].type === 'text' ? response.content[0].text : '';
          const usage = response.usage;
          const result = extractJson(content || '{}');
          result.modelUsed = model || 'claude-3-7-sonnet-latest';
          
          if (usage) {
            result.usageMetadata = {
              promptTokenCount: usage.input_tokens,
              candidatesTokenCount: usage.output_tokens,
              totalTokenCount: usage.input_tokens + usage.output_tokens
            };
          }
          
          jobs.set(jobId, { ...jobs.get(jobId)!, status: 'completed', result });
          return;
        }

        throw new Error('Invalid provider');
      } catch (error: any) {
        console.error(`[Job ${jobId}] Error:`, error);
        jobs.set(jobId, { ...jobs.get(jobId)!, status: 'failed', error: error.message });
      }
    })();

    // Return jobId immediately
    res.json({ jobId });
  });

  app.get('/api/extract/status/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);
    if (!job) {
      console.warn(`[API] Job status check failed - Job ${jobId} not found`);
      return res.status(404).json({ error: 'Job not found' });
    }
    console.log(`[API] Job status check - Job ${jobId}: ${job.status}`);
    res.json(job);
  });

  app.get('/api/health', (req, res) => {
    const mask = (key: string | undefined) => {
      if (!key || key === 'undefined') return 'missing';
      if (key.length < 8) return 'too short';
      return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
    };

    res.json({
      status: 'ok',
      uptime: process.uptime(),
      version: '1.2.1',
      hostname: req.headers.host,
      nodeEnv: process.env.NODE_ENV,
      proxy: {
        forwardedFor: req.headers['x-forwarded-for'],
        forwardedProto: req.headers['x-forwarded-proto'],
        realIp: req.headers['x-real-ip'],
      },
      keys: {
        gemini: mask(process.env.GEMINI_API_KEY),
        openai: mask(process.env.OPENAI_API_KEY),
        anthropic: mask(process.env.ANTHROPIC_API_KEY),
      }
    });
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

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Increase timeouts for long-running LLM extractions (up to 10 minutes)
  server.timeout = 600000;
  server.keepAliveTimeout = 610000;
  server.headersTimeout = 620000;
}

startServer();
