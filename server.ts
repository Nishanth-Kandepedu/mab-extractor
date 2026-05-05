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

// Concurrency control: Limit heavy LLM extractions to 3 at a time (conservative for reliability)
const limit = pLimit(3);

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
 * Robustly extracts and repairs JSON from a string that might be truncated or malformed.
 */
function extractJson(text: string): any {
  if (!text || typeof text !== 'string') {
    throw new Error("Empty or invalid response received from AI");
  }

  const cleanText = text.trim();

  // 1. Try direct parsing
  try {
    return JSON.parse(cleanText);
  } catch (e) {
    // Continue
  }

  // 2. Try to find JSON block in markdown
  const markdownMatch = cleanText.match(/```json\s*([\s\S]*?)\s*```/) || cleanText.match(/```\s*([\s\S]*?)\s*```/);
  if (markdownMatch && markdownMatch[1]) {
    const inner = markdownMatch[1].trim();
    try {
      return JSON.parse(inner);
    } catch (e) {
      try {
        return repairAndParseJson(inner);
      } catch (e2) {}
    }
  }

  // 3. Find the first '{' and try to parse/repair from there
  const firstBrace = cleanText.indexOf('{');
  if (firstBrace !== -1) {
    const lastBrace = cleanText.lastIndexOf('}');
    let candidate = "";
    
    if (lastBrace !== -1 && lastBrace > firstBrace) {
      candidate = cleanText.substring(firstBrace, lastBrace + 1);
    } else {
      candidate = cleanText.substring(firstBrace);
    }

    try {
      return JSON.parse(candidate);
    } catch (e) {
      try {
        return repairAndParseJson(candidate);
      } catch (e2) {
        console.error("JSON Repair failed. Snippet:", cleanText.substring(0, 200));
        throw new Error("Could not parse or repair JSON response.");
      }
    }
  }

  throw new Error("No JSON found in response.");
}

/**
 * Attempts to repair truncated JSON.
 */
function repairAndParseJson(jsonStr: string): any {
  let repaired = jsonStr.trim();
  
  // Remove trailing commas which are common in truncated JSON
  repaired = repaired.replace(/,\s*$/, "");
  repaired = repaired.replace(/,\s*([}\]])/g, "$1");

  const stack: string[] = [];
  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];
    if (char === '{' || char === '[') {
      stack.push(char);
    } else if (char === '}' || char === ']') {
      const last = stack.pop();
      if ((char === '}' && last !== '{') || (char === ']' && last !== '[')) {
        // Mismatched - continue anyway
      }
    }
  }

  // Close remaining open structures in reverse order
  while (stack.length > 0) {
    const last = stack.pop();
    if (last === '{') repaired += '}';
    else if (last === '[') repaired += ']';
  }

  try {
    return JSON.parse(repaired);
  } catch (e) {
    // If it still fails, try one more aggressive trim to the last valid closing character
    const lastClosing = Math.max(repaired.lastIndexOf('}'), repaired.lastIndexOf(']'));
    if (lastClosing !== -1) {
      try {
        return JSON.parse(repaired.substring(0, lastClosing + 1));
      } catch (e2) {
        throw e; // Give up
      }
    }
    throw e;
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Trust proxy for Railway/Cloud Run
  app.set('trust proxy', 1);
  
  // Enable CORS for all origins
  app.use(cors());

  app.use(express.json({ limit: '200mb' }));
  app.use(express.urlencoded({ limit: '200mb', extended: true }));

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
    const { provider, model, input, systemInstruction, responseSchema, thinkingLevel, isExtendedMode } = req.body;
    
    if (!input || (typeof input === 'string' && input.trim().length === 0)) {
      return res.status(400).json({ error: "Input text is required." });
    }

    const jobId = Math.random().toString(36).substring(7);
    await updateJob(jobId, { status: 'pending', startTime: Date.now(), isExtendedMode });

    if (isExtendedMode) {
      console.log(`[Job ${jobId}] Running in EXTENDED MODE (Increased session stability enabled)`);
    }

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
      const MAX_RETRIES = 3;

      const runExtraction = async (): Promise<void> => {
        try {
          console.log(`[Job ${jobId}] Attempt ${retryCount + 1} for ${provider}/${model}`);

          // Timeout mechanism for the extraction itself: 8m (standard) vs 30m (extended)
          const TIMEOUT_MS = isExtendedMode ? 1800000 : 480000; 
          
          const extractionPromise = (async () => {
             if (provider === 'gemini' || provider === 'gemma') {
               const apiKey = findKey('GEMINI_API_KEY');
               if (!apiKey || apiKey === 'undefined') throw new Error('Missing Gemini API Key.');

               const ai = new GoogleGenAI({ apiKey });
               
               // Unify request structure for all Gemini/Gemma models
               const contents = typeof input === 'string' 
                 ? [{ role: 'user', parts: [{ text: input }] }] 
                 : [{ role: 'user', parts: input }];

               const response = await ai.models.generateContent({
                 model: targetModel || 'gemini-3.1-pro-preview',
                 contents,
                 config: {
                   systemInstruction,
                   temperature: 0,
                   thinkingConfig: (thinkingLevel === 'HIGH' || thinkingLevel === 'LOW') ? { 
                     thinkingLevel: thinkingLevel === 'HIGH' ? ThinkingLevel.HIGH : ThinkingLevel.LOW
                   } : undefined,
                   maxOutputTokens: 65536,
                   responseMimeType: "application/json",
                   responseSchema: responseSchema,
                 },
               });

               const text = response.text;
               const usage = response.usageMetadata;
               
               if (!text) throw new Error("Empty response from AI engine");
               
               const result = extractJson(text);
               const count = result.antibodies?.length || 0;
               console.log(`[Job ${jobId}] Extracted ${count} antibodies successfully`);
               
               if (usage) {
                 result.usageMetadata = {
                   promptTokenCount: usage.promptTokenCount,
                   candidatesTokenCount: usage.candidatesTokenCount,
                   thinkingTokenCount: (usage as any).thinkingTokenCount,
                   cachedContentTokenCount: (usage as any).cachedContentTokenCount,
                   totalTokenCount: usage.totalTokenCount
                 };
               }
               
               return { status: 'completed', result };
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
               return { status: 'completed', result };
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
               return { status: 'completed', result };
             }
             throw new Error(`Unsupported provider: ${provider}`);
          })();

          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('AI Engine Timeout (Request exceeded execution window)')), TIMEOUT_MS)
          );

          const finalJobUpdate = await Promise.race([extractionPromise, timeoutPromise]) as any;
          await updateJob(jobId, finalJobUpdate);

        } catch (error: any) {
          const errorMessage = error.message || String(error);
          const lowerError = errorMessage.toLowerCase();
          
          const isCapacityError = lowerError.includes('capacity') || 
                                  lowerError.includes('503') || 
                                  lowerError.includes('429') ||
                                  lowerError.includes('internal error');
          
          const isTimeout = lowerError.includes('timeout') || lowerError.includes('deadline');

          // Fail-Fast: Retry capacity errors, but DO NOT retry timeouts to avoid blocking the queue.
          const maxRetriesForThisError = isTimeout ? 0 : MAX_RETRIES;

          if (retryCount < maxRetriesForThisError && (isCapacityError || isTimeout)) {
            retryCount++;
            // Exponential backoff with jitter
            const baseDelay = Math.pow(2, retryCount) * 2000;
            const jitter = Math.random() * 2000;
            const delay = baseDelay + jitter;
            
            console.warn(`[Job ${jobId}] Retryable error (${errorMessage}). Retrying in ${Math.round(delay / 1000)}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return runExtraction();
          }

          console.error(`[Job ${jobId}] Permanent Failure:`, errorMessage);
          await updateJob(jobId, { 
            status: 'failed', 
            error: isTimeout 
              ? 'AI Engine Timeout: This document is complex and may require Extended Mode.' 
              : (isCapacityError ? 'AI engine at capacity. Retrying later is recommended.' : errorMessage)
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
  // Increase global timeout to 30 minutes for high-volume patent processing
  server.timeout = 1800000;
  server.keepAliveTimeout = 120000;
  server.headersTimeout = 130000;
}

startServer();
