import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import dotenv from 'dotenv';
import cors from 'cors';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import pLimit from 'p-limit';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin with extra safety
let db: any = null;
try {
  const configPath = path.join(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    // Check if already initialized
    if (getApps().length === 0) {
      initializeApp({
        projectId: config.projectId,
      });
    }
    db = getFirestore();
    console.log('[Firebase] Admin SDK initialized successfully');
  } else {
    console.warn('[Firebase] Config file not found, persistent jobs disabled');
  }
} catch (error) {
  console.error('[Firebase] Failed to initialize Admin SDK:', error);
}

// Concurrency control: Limit heavy LLM extractions to 2 at a time
const limit = pLimit(2);

// In-memory job store (Fallback/Cache)
const jobsCache = new Map<string, any>();

async function getJob(jobId: string) {
  // Always check cache first for speed
  if (jobsCache.has(jobId)) return jobsCache.get(jobId);
  
  if (db) {
    try {
      const doc = await db.collection('extraction_jobs').doc(jobId).get();
      if (doc.exists) {
        const data = doc.data();
        jobsCache.set(jobId, data);
        return data;
      }
    } catch (e) {
      console.error(`[Firebase] Error fetching job ${jobId}:`, e);
    }
  }
  return null;
}

async function updateJob(jobId: string, data: any) {
  const updated = { ...data, updatedAt: Date.now() };
  jobsCache.set(jobId, updated);
  
  if (db) {
    try {
      await db.collection('extraction_jobs').doc(jobId).set(updated, { merge: true });
    } catch (e) {
      console.error(`[Firebase] Error updating job ${jobId}:`, e);
    }
  }
}

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

  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // Force HTTPS and security headers in production
  if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
      const proto = req.headers['x-forwarded-proto'];
      if (proto && proto !== 'https') {
        return res.redirect(301, `https://${req.headers.host}${req.url}`);
      }
      next();
    });
  }

  // API Routes
  app.post('/api/extract', async (req, res) => {
    const { provider, model, input, systemInstruction, responseSchema, thinkingLevel } = req.body;
    
    if (!input || (typeof input === 'string' && input.trim().length === 0)) {
      return res.status(400).json({ error: "Input text is required." });
    }

    const jobId = Math.random().toString(36).substring(7);
    await updateJob(jobId, { status: 'pending', startTime: Date.now() });

    // Map custom or experimental models to valid Gemini API IDs
    const mapModel = (m: string) => {
      const lowerM = m?.toLowerCase() || '';
      if (lowerM === 'gemma-4') return 'models/gemma-4-31b-it';
      return m;
    };

    const targetModel = mapModel(model);

    // Helper to find keys case-insensitively
    const findKey = (pattern: string) => {
      const p = pattern.toUpperCase();
      const key = Object.keys(process.env).find(k => k.toUpperCase().includes(p));
      return key ? process.env[key] : null;
    };

    // Start extraction in background with concurrency limit
    limit(async () => {
      const jobStartTime = Date.now();
      let retryCount = 0;
      const MAX_RETRIES = 2;

      const runExtraction = async (): Promise<void> => {
        try {
          console.log(`[Job ${jobId}] Attempt ${retryCount + 1} for ${provider}/${model}`);

          if (provider === 'gemini') {
            const apiKey = findKey('GEMINI_API_KEY');
            if (!apiKey || apiKey === 'undefined') throw new Error('Missing Gemini API Key.');

            const ai = new GoogleGenAI({ apiKey });
            
            const isGemma = targetModel === 'models/gemma-4-31b-it';
            
            // Fix request structure: Ensure contents matches the Gemini API expectations
            const contents = typeof input === 'string' 
              ? [{ role: 'user', parts: [{ text: isGemma ? `${systemInstruction}\n\n${input}` : input }] }] 
              : [{ role: 'user', parts: input }];

            const response = await ai.models.generateContent({
              model: targetModel || 'gemini-3.1-pro-preview',
              contents,
              config: {
                systemInstruction: isGemma ? undefined : systemInstruction,
                temperature: 0,
                thinkingConfig: thinkingLevel ? { 
                  thinkingLevel: thinkingLevel === 'HIGH' ? ThinkingLevel.HIGH : 
                                 thinkingLevel === 'LOW' ? ThinkingLevel.LOW : 
                                 ThinkingLevel.MINIMAL 
                } : undefined,
                maxOutputTokens: 65536,
                responseMimeType: isGemma ? "text/plain" : "application/json",
                responseSchema: isGemma ? undefined : responseSchema,
              },
            });

            const text = response.text;
            const usage = response.usageMetadata;
            
            if (!text) throw new Error("Empty response from AI engine");
            
            const result = extractJson(text);
            if (usage) {
              result.usageMetadata = {
                promptTokenCount: usage.promptTokenCount,
                candidatesTokenCount: usage.candidatesTokenCount,
                thinkingTokenCount: (usage as any).thinkingTokenCount,
                cachedContentTokenCount: (usage as any).cachedContentTokenCount,
                totalTokenCount: usage.totalTokenCount
              };
            }
            
            await updateJob(jobId, { status: 'completed', result });
          } else if (provider === 'openai') {
            const apiKey = findKey('OPENAI_API_KEY');
            if (!apiKey) throw new Error('Missing OpenAI API Key.');
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
            const content = response.choices[0].message.content || '{}';
            const usage = response.usage;
            const result = extractJson(content);
            if (usage) {
              result.usageMetadata = {
                promptTokenCount: usage.prompt_tokens,
                candidatesTokenCount: usage.completion_tokens,
                totalTokenCount: usage.total_tokens
              };
            }
            await updateJob(jobId, { status: 'completed', result });
          } else if (provider === 'anthropic') {
            const apiKey = findKey('ANTHROPIC_API_KEY');
            if (!apiKey) throw new Error('Missing Anthropic API Key.');
            const anthropic = new Anthropic({ apiKey });
            const response = await anthropic.messages.create({
              model: model || 'claude-3-5-sonnet-latest',
              max_tokens: 4096,
              system: systemInstruction,
              messages: [{ role: 'user', content: typeof input === 'string' ? input : 'Extract from it.' }],
              temperature: 0,
            });
            const content = response.content[0].type === 'text' ? response.content[0].text : '';
            const usage = response.usage;
            const result = extractJson(content || '{}');
            if (usage) {
              result.usageMetadata = {
                promptTokenCount: usage.input_tokens,
                candidatesTokenCount: usage.output_tokens,
                totalTokenCount: usage.input_tokens + usage.output_tokens
              };
            }
            await updateJob(jobId, { status: 'completed', result });
          }
        } catch (error: any) {
          const errorMessage = error.message || String(error);
          const lowerError = errorMessage.toLowerCase();
          
          const isRetryable = lowerError.includes('capacity') || 
                             lowerError.includes('503') || 
                             lowerError.includes('429') ||
                             lowerError.includes('internal error') ||
                             lowerError.includes('timeout');

          if (isRetryable && retryCount < MAX_RETRIES) {
            retryCount++;
            const delay = Math.pow(2, retryCount) * 1000;
            console.warn(`[Job ${jobId}] Retryable error (${errorMessage}). Retrying in ${delay / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return runExtraction();
          }

          console.error(`[Job ${jobId}] Permanent Failure:`, errorMessage);
          await updateJob(jobId, { 
            status: 'failed', 
            error: isRetryable 
              ? 'The AI engine is currently over capacity or experienced a transient error. Please wait a moment and try again.' 
              : errorMessage 
          });
        } finally {
          if (retryCount === 0 || retryCount === MAX_RETRIES) {
            const duration = ((Date.now() - jobStartTime) / 1000).toFixed(1);
            console.log(`[Job ${jobId}] Completed/Failed in ${duration}s`);
          }
        }
      };

      await runExtraction();
    });

    res.json({ jobId });
  });

  app.get('/api/extract/status/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const job = await getJob(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  });

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      version: '1.2.5',
      persistence: !!db,
      concurrency: {
        activeCount: limit.activeCount,
        pendingCount: limit.pendingCount
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  const server = app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
  server.timeout = 600000;
}

startServer();
