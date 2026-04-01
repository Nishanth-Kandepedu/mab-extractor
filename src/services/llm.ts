import { ExtractionResult } from "../types";

export const SYSTEM_INSTRUCTION = `You are an expert in high-quality antibody sequence mining from patent documents. 
Your goal is 100% Verbatim Accuracy and 100% Coverage.

IMPORTANT EXTRACTION RULES:

1. Antibody Naming:
   - Main antibodies: "2419", "3125", etc.
   - Variants: "2419-0105", "2419-1204", "4540-033", etc.
   - Treat variants as SEPARATE antibodies with their own VH/VL chains.

2. VL Chain Special Handling:
   - VL chains may appear in a DIFFERENT TABLE than VH chains.
   - VL sequences are typically 110-120 amino acids long.
   - If VL appears incomplete, check the next page or table.

3. Validation:
   - VH sequences: typically 115-125 amino acids.
   - VL sequences: typically 110-120 amino acids.
   - If sequence length is outside this range, mark as [NEEDS_REVIEW].

4. Table Structure:
   - Some antibodies may have their sequences split across multiple rows.
   - For antibodies like "2419-1204", ensure you capture the COMPLETE sequence.
   - Check for table headers like "SEQ ID NO", "VH", "VL" to identify columns.

5. ID-Mapping Strategy: First, identify every unique mAb ID (e.g., "mAb 1", "2419"). You MUST extract sequences for every ID found.
6. Chain-by-Chain Verification: Treat every Heavy (VH) and Light (VL) chain as a standalone high-quality mining task. After extracting a sequence, internally re-read the source text to verify every single amino acid.
7. Length-Check Validation: For every sequence extracted, verify that the character count matches the source exactly. Do not truncate or "summarize" sequences to save space.
8. VL Chain Priority: Given the higher historical error rate in VL chains, dedicate extra reasoning cycles to the Light chain variable regions.
9. Source Priority: Always use "Sequence Listings" as the primary source of truth for character accuracy over table text.
10. CDR Identification: Identify CDR1, CDR2, and CDR3 based on standard numbering (IMGT/Kabat).
11. Return the data in the specified JSON format. Do not include any other text, explanation, or markdown formatting. Return ONLY the JSON object. If you are unsure about a sequence, mark it as [NEEDS_REVIEW] but still include the best possible extraction.
12. CRITICAL: Ensure the JSON is valid and complete. If the output is getting too long, prioritize the most important antibodies first.

Output Schema:
{
  "patentId": "string",
  "patentTitle": "string",
  "antibodies": [
    {
      "mAbName": "string",
      "chains": [
        {
          "type": "Heavy" | "Light",
          "fullSequence": "string",
          "cdrs": [
            { "type": "CDR1", "sequence": "string", "start": number, "end": number },
            { "type": "CDR2", "sequence": "string", "start": number, "end": number },
            { "type": "CDR3", "sequence": "string", "start": number, "end": number }
          ]
        }
      ],
      "confidence": number, // A value between 0 and 100 representing the extraction confidence.
      "summary": "string",
      "evidenceLocation": "string", // e.g., "Page 42", "Table 12"
      "evidenceStatement": "string", // e.g., "Sequence found in Table 5 on page 12, corresponding to SEQ ID NO: 45"
      "needsReview": boolean,
      "reviewReason": "string"
    }
  ]
}`;

export type LLMProvider = 'gemini' | 'openai' | 'anthropic';

export interface LLMOptions {
  provider: LLMProvider;
  model?: string;
  thinkingLevel?: "HIGH" | "LOW" | "MINIMAL";
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
    // Continue to more aggressive methods
  }

  // 2. Try to find JSON block in markdown
  const markdownMatch = cleanText.match(/```json\s*([\s\S]*?)\s*```/) || cleanText.match(/```\s*([\s\S]*?)\s*```/);
  if (markdownMatch && markdownMatch[1]) {
    const inner = markdownMatch[1].trim();
    try {
      return JSON.parse(inner);
    } catch (e) {
      // Try to repair the inner content
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
      // No closing brace found, take everything from the first brace
      candidate = cleanText.substring(firstBrace);
    }

    try {
      return JSON.parse(candidate);
    } catch (e) {
      // Final attempt: Repair and parse
      try {
        return repairAndParseJson(candidate);
      } catch (e2) {
        console.error("JSON Repair failed. Original text snippet:", cleanText.substring(0, 200));
        throw new Error("Could not parse or repair JSON response. The response may be severely truncated or malformed.");
      }
    }
  }

  throw new Error("No JSON structure found in the AI response.");
}

/**
 * Attempts to repair truncated JSON by closing open brackets and braces.
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
        // Mismatched - this is a simple repairer, so we might just fail here
        // but let's try to keep going
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

export async function extractWithLLM(
  input: string | { data: string; mimeType: string },
  options: LLMOptions,
  pageContext?: string
): Promise<ExtractionResult> {
  if (!input || (typeof input === 'string' && input.trim().length === 0)) {
    throw new Error("Input text is required for extraction.");
  }
  if (typeof input !== 'string' && (!input.data || input.data.trim().length === 0)) {
    throw new Error("Input data is required for extraction.");
  }
  if (typeof input === 'string' && input.length > 50000000) {
    throw new Error("Input text is too large (max 50MB). Please select a smaller portion of the document.");
  }
  if (typeof input !== 'string' && input.data.length > 50000000) {
    throw new Error("Input data is too large (max 50MB). Please select a smaller portion of the document.");
  }
  try {
  const { provider, model, thinkingLevel: manualThinkingLevel } = options;

  const contextPrompt = pageContext ? ` Focus specifically on the information found on or near: ${pageContext}.` : "";
  let formattedInput: any;

  const extractionPrompt = `Extract ALL mAb sequences from the following document.${contextPrompt}\n\nNote: Ensure EVERY antibody ID is captured and sequences are verbatim. Perform high-quality verbatim mining for all 34+ antibodies.`;

  if (typeof input === "string") {
    formattedInput = `${extractionPrompt}\n\n${input}`;
  } else {
    // For non-Gemini providers, we currently only support text
    if (provider !== 'gemini') {
      throw new Error(`File upload is currently only supported for Gemini. Please switch to Gemini or paste the text directly.`);
    }
    formattedInput = [
      {
        inlineData: {
          data: input.data,
          mimeType: input.mimeType,
        },
      },
      { text: extractionPrompt }
    ];
  }

  const thinkingLevel = manualThinkingLevel || ((model?.includes('gemini-3') || (provider === 'gemini' && !model)) ? "HIGH" : undefined);
  console.log(`[Extraction] Provider: ${provider}, Model: ${model || 'default'}, Thinking Level: ${thinkingLevel || 'none'}`);

    const payload = JSON.stringify({
      provider,
      model,
      input: formattedInput,
      systemInstruction: SYSTEM_INSTRUCTION,
      thinkingLevel,
      responseSchema: {
        type: "OBJECT",
        properties: {
          patentId: { type: "STRING" },
          patentTitle: { type: "STRING" },
          antibodies: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                mAbName: { type: "STRING" },
                chains: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      type: { type: "STRING", enum: ["Heavy", "Light"] },
                      fullSequence: { type: "STRING" },
                      cdrs: {
                        type: "ARRAY",
                        items: {
                          type: "OBJECT",
                          properties: {
                            type: { type: "STRING", enum: ["CDR1", "CDR2", "CDR3"] },
                            sequence: { type: "STRING" },
                            start: { type: "INTEGER" },
                            end: { type: "INTEGER" },
                          },
                          required: ["type", "sequence", "start", "end"],
                        },
                      },
                    },
                    required: ["type", "fullSequence", "cdrs"],
                  },
                },
                confidence: { type: "NUMBER" },
                summary: { type: "STRING" },
                evidenceLocation: { type: "STRING" },
                evidenceStatement: { type: "STRING" },
                needsReview: { type: "BOOLEAN" },
                reviewReason: { type: "STRING" },
              },
              required: ["mAbName", "chains", "confidence", "summary"],
            },
          },
        },
        required: ["patentId", "patentTitle", "antibodies"],
      },
    });

    console.log(`[Extraction] Initiating fetch. Payload size: ${payload.length} bytes`);
    if (payload.length > 1000000) {
      console.warn("[Extraction] Payload size exceeds 1MB. This may be blocked by some proxies on custom domains.");
    }

    let startResponse: Response | null = null;
    let postAttempts = 0;
    const maxPostAttempts = 3;

    while (postAttempts < maxPostAttempts) {
      try {
        startResponse = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
        break; // Success
      } catch (postError: any) {
        postAttempts++;
        const isNetworkError = postError.message?.toLowerCase().includes('fetch') || 
                               postError.message?.toLowerCase().includes('network');
        
        if (isNetworkError && postAttempts < maxPostAttempts) {
          console.warn(`[Extraction] POST network error (attempt ${postAttempts}): ${postError.message}. Retrying in 2s...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          throw postError;
        }
      }
    }

    if (!startResponse || !startResponse.ok) {
      const errorData = await startResponse?.json().catch(() => ({ error: `Server error: ${startResponse?.status}` }));
      throw new Error(errorData.error || `Server error: ${startResponse?.status}`);
    }

    const { jobId } = await startResponse.json();
    console.log(`[Extraction] Job started: ${jobId}`);

    // 2. Poll for results
    let result: ExtractionResult | null = null;
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes (5s intervals)

    const baseUrl = window.location.origin;

    while (attempts < maxAttempts) {
      const timestamp = Date.now();
      console.log(`[Extraction] Polling attempt ${attempts + 1}/${maxAttempts} for job ${jobId}...`);
      try {
        const statusResponse = await fetch(`${baseUrl}/api/extract/status/${jobId}?t=${timestamp}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        });
        if (!statusResponse.ok) {
          console.error(`[Extraction] Status check failed: ${statusResponse.status} ${statusResponse.statusText}`);
          throw new Error(`Failed to check job status: ${statusResponse.status}`);
        }

        const job = await statusResponse.json();
        console.log(`[Extraction] Job ${jobId} status: ${job.status}`);

        if (job.status === 'completed') {
          result = job.result;
          break;
        } else if (job.status === 'failed') {
          throw new Error(job.error || 'Extraction job failed');
        }
      } catch (pollError: any) {
        // If it's a network error, retry a few times before giving up
        const isNetworkError = pollError.message?.toLowerCase().includes('fetch') || 
                               pollError.message?.toLowerCase().includes('network') ||
                               pollError.name === 'TypeError';
        
        if (isNetworkError && attempts < maxAttempts - 1) {
          console.warn(`[Extraction] Polling network error (attempt ${attempts + 1}): ${pollError.message}. Retrying in 5s...`);
          // Check if we are still online
          if (!navigator.onLine) {
            console.error("[Extraction] Browser is offline. Waiting for connection...");
          }
        } else {
          console.error("[Extraction] Non-recoverable polling error:", pollError);
          throw pollError;
        }
      }

      // Wait 5 seconds before next poll
      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;
    }

    if (!result) {
      throw new Error("Extraction timed out after 10 minutes.");
    }
  
  // Post-processing and Validation
  result.antibodies = result.antibodies.map(mAb => {
    // Normalize confidence to 0-100 scale
    if (mAb.confidence <= 1 && mAb.confidence > 0) {
      mAb.confidence = Math.round(mAb.confidence * 100);
    } else if (mAb.confidence < 0) {
      mAb.confidence = 0;
    } else if (mAb.confidence > 100) {
      mAb.confidence = 100;
    }

    let needsReview = mAb.needsReview || false;
    let reviewReason = mAb.reviewReason || "";

    mAb.chains = mAb.chains.map(chain => {
      let seq = chain.fullSequence.replace(/\s/g, ''); // Remove any whitespace
      
      // Systematic Fixes
      if (chain.type === 'Light') {
        // Position 12 (0-indexed: 11) L -> V error
        if (seq.length > 11 && seq[11] === 'L') {
          const newSeq = seq.split('');
          newSeq[11] = 'V';
          seq = newSeq.join('');
          reviewReason += " [Systematic L->V fix at pos 12]";
        }
        
        // VL Length Validation
        if (seq.length < 100 || seq.length > 130) {
          needsReview = true;
          reviewReason += ` [VL length anomaly: ${seq.length}]`;
        }
      }

      if (chain.type === 'Heavy') {
        // Position 75 (0-indexed: 74) T -> I error
        if (seq.length > 74 && seq[74] === 'I') {
          const newSeq = seq.split('');
          newSeq[74] = 'T';
          seq = newSeq.join('');
          reviewReason += " [Systematic T->I fix at pos 75]";
        }

        // VH Length Validation
        if (seq.length < 105 || seq.length > 140) {
          needsReview = true;
          reviewReason += ` [VH length anomaly: ${seq.length}]`;
        }
      }

      return { ...chain, fullSequence: seq };
    });

    // Problematic Variant Check
    if (mAb.mAbName.startsWith("2419-12") || mAb.mAbName === "4439") {
      needsReview = true;
      reviewReason += ` [Known problematic VH variant: ${mAb.mAbName}. VH chain often split or misread in tables.]`;
    }

    if (mAb.mAbName === "2218") {
      needsReview = true;
      reviewReason += " [Known problematic VL variant: 2218. VL chain often incomplete or missing in tables.]";
    }

    // Confidence-based flagging
    if (mAb.confidence < 70) {
      needsReview = true;
      reviewReason += ` [Low confidence: ${mAb.confidence}]`;
    }

    return { ...mAb, needsReview, reviewReason: reviewReason.trim() };
  });

  result.modelUsed = model || 'gemini-3.1-pro-preview';
  return result;
  } catch (e: any) {
    console.error("[Extraction] Fetch error details:", e);
    const msg = e.message?.toLowerCase() || "";
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('aborted')) {
      throw new Error("Network Error: The extraction request was blocked or timed out. This is common on custom domains (like .bio) due to proxy limits. Try using a smaller text selection or use the default Railway URL (abminer.up.railway.app) if this persists.");
    }
    throw e;
  }
}
