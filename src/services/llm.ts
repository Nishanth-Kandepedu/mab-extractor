import { ExtractionResult } from "../types";

export const SYSTEM_INSTRUCTION = `You are an expert in high-quality antibody sequence mining from patent documents. 
Your goal is 100% Verbatim Accuracy and 100% Coverage.

IMPORTANT EXTRACTION RULES:

1. Antibody Identification & Naming:
   - Main antibodies: "2419", "3125", etc.
   - Variants: "2419-0105", "2419-1204", "4540-033", etc.
   - Bispecific/Multispecific Antibodies: Explicitly identify and extract bispecific antibodies (e.g., "bsAb", "BiTE", "scFv-Fc"). Note that bispecifics may contain MULTIPLE distinct heavy or light chains or linked fragments.
   - Treat variants as SEPARATE antibodies with their own VH/VL chains.

2. C-Terminal & CDR3 Precision (CRITICAL):
   - AVOID C-TERMINAL TRUNCATION: Most errors cluster in the last 25 amino acids (CDR3 and Framework 4). 
   - You MUST ensure the sequence does not end prematurely. Single amino acid deletions at the C-terminus cause cascading alignment errors.
   - Re-verify the last 20 amino acids of every sequence against the source text at least THREE times.
   - Pay extreme attention to hypervariable CDR3 regions which are harder to parse but must be verbatim.

3. OCR Error Awareness (Visual Confusions):
   - PATENT PDF OCR IS PRONE TO ERROR. You MUST perform mental "visual disambiguation" for common confusions:
     * V vs L (The most common error! Verify every V and L carefully)
     * I vs T
     * S vs T
     * F vs P
   - If a sequence looks "broken" or has an unexpected amino acid, check if it's a visual OCR mistake from the PDF source.

4. Heavy Chain Scrutiny:
   - Heavy chains (VH) are nearly 2x more prone to errors than light chains.
   - VH sequences are longer (~120-130 aa).
   - Allocate MORE reasoning cycles and "thinking" tokens to Heavy chain extraction.

5. VL Chain Special Handling:
   - VL chains may appear in a DIFFERENT TABLE than VH chains.
   - If VL appears incomplete, check the next page or table.

6. Validation & Domain Boundary:
   - VH sequences: typically 115-125 amino acids. Ends with conserved "WGXG" motif.
   - VL sequences: typically 110-120 amino acids. Ends with conserved "FGXG" motif.
   - VARIABLE DOMAIN ONLY: Extract ONLY the Variable Domain (Fv). Do NOT include Constant Regions (CH1, CL).
   - Terminate immediately after the J-segment (Framework 4) motifs (WGXG for Heavy, FGXG for Light).

7. Mandatory SEQ ID & Evidence:
   - Extract the "SEQ ID NO" for every sequence.
   - Capture page number and table ID.
   - "evidenceStatement" must include SEQ ID, page, and table coordinates.

8. ID-Mapping & Target Identification: 
   - Identify every unique ID (e.g., "mAb 1", "bsAb 2").
   - Extract the primary target (antigen) (e.g., HER2, CD20) for every antibody.

9. Length-Check & Alignment:
   - Verify character counts match the source exactly.
   - Ensure the N-terminus and C-terminus are perfectly aligned with the source listing or table.

10. Logic Passes:
    - Pass 1: Identify all mAb/bsAb IDs and their corresponding SEQ IDs.
    - Pass 2: Extract sequences verbatim.
    - Pass 3: Review the C-terminal 25 amino acids for any missing characters or OCR-confusions (V/L, I/T).

11. Return ONLY valid JSON. If output length is a concern, prioritize full extraction of the most important sequences first.

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
          "seqId": "string", // Mandatory: e.g., "SEQ ID NO: 45"
          "pageNumber": number, // Mandatory
          "tableId": "string", // Optional: e.g., "Table 2"
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
  pageContext?: string,
  sequenceListing?: { data: string; mimeType: string }
): Promise<ExtractionResult> {
  if (!input || (typeof input === 'string' && input.trim().length === 0)) {
    throw new Error("Input text is required for extraction.");
  }
  if (typeof input !== 'string' && (!input.data || input.data.trim().length === 0)) {
    throw new Error("Input data is required for extraction.");
  }
  
  try {
    const { provider, model } = options;

  const contextPrompt = pageContext ? ` Focus specifically on the information found on or near: ${pageContext}.` : "";
  let formattedInput: any;

  if (typeof input === "string") {
    formattedInput = `Extract ALL mAb sequences from the following text.${contextPrompt}\n\nNote: Ensure EVERY antibody ID is captured and sequences are verbatim.\n\n${input}`;
  } else {
    // For non-Gemini providers, we currently only support text
    if (provider !== 'gemini') {
      throw new Error(`File upload is currently only supported for Gemini. Please switch to Gemini or paste the text directly.`);
    }
    
    const parts: any[] = [
      {
        inlineData: {
          data: input.data,
          mimeType: input.mimeType,
        },
      }
    ];

    if (sequenceListing) {
      parts.push({
        inlineData: {
          data: sequenceListing.data,
          mimeType: sequenceListing.mimeType,
        },
      });
      parts.push({ text: `Extract ALL mAb sequences from the provided patent document and sequence listing file.${contextPrompt} Use the sequence listing as the primary source for character accuracy, and the patent document for context (mAb names, chain types, etc.). Perform high-quality verbatim mining.` });
    } else {
      parts.push({ text: `Extract ALL mAb sequences from this document.${contextPrompt} Perform high-quality verbatim mining.` });
    }

    formattedInput = parts;
  }

    const payload = JSON.stringify({
      provider,
      model,
      input: formattedInput,
      systemInstruction: SYSTEM_INSTRUCTION,
      thinkingLevel: model?.includes('3.1') ? "HIGH" : undefined,
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
                      seqId: { type: "STRING" },
                      pageNumber: { type: "INTEGER" },
                      tableId: { type: "STRING" },
                      target: { type: "STRING" }, // Mandatory: e.g., "HER2"
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
                    required: ["type", "fullSequence", "cdrs", "seqId", "pageNumber", "target"],
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
        const errorMsg = pollError.message?.toLowerCase() || "";
        const isNetworkError = errorMsg.includes('fetch') || 
                               errorMsg.includes('network') ||
                               errorMsg.includes('aborted') ||
                               errorMsg.includes('failed to fetch') ||
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

      // Wait 5 seconds before next poll with jitter
      const jitter = Math.floor(Math.random() * 1000);
      await new Promise(resolve => setTimeout(resolve, 5000 + jitter));
      attempts++;
    }

    if (!result) {
      throw new Error("Extraction timed out after 10 minutes.");
    }
  
  // Post-processing and Validation
  result.patentId = result.patentId || "Unknown";
  result.patentTitle = result.patentTitle || "Untitled Patent";
  result.antibodies = result.antibodies || [];
  
  const STANDARD_AMINO_ACIDS = new Set("ACDEFGHIKLMNPQRSTVWY");

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
      
      // Re-calculate CDR indices to ensure they sync with the full sequence
      // This is more robust than relying on LLM-generated indices which are often off-by-one or hallucinated.
      let lastCdrEnd = 0;
      chain.cdrs = chain.cdrs.map(cdr => {
        const cleanCdrSeq = cdr.sequence.replace(/\s/g, '');
        // Search for the CDR sequence within the full sequence, starting from the end of the last CDR
        let foundIndex = seq.indexOf(cleanCdrSeq, lastCdrEnd);
        
        // If not found after last CDR, try searching from the beginning (in case of out-of-order extraction)
        if (foundIndex === -1) {
          foundIndex = seq.indexOf(cleanCdrSeq);
        }

        if (foundIndex !== -1) {
          const newStart = foundIndex;
          const newEnd = foundIndex + cleanCdrSeq.length;
          lastCdrEnd = newEnd;
          return { ...cdr, sequence: cleanCdrSeq, start: newStart, end: newEnd };
        }
        
        // Fallback: if sequence not found verbatim, keep original but warn
        return { ...cdr, sequence: cleanCdrSeq };
      });

      // Non-standard amino acid detection
      const nonStandard: string[] = [];
      for (const char of seq) {
        if (!STANDARD_AMINO_ACIDS.has(char.toUpperCase())) {
          nonStandard.push(char);
        }
      }

      if (nonStandard.length > 0) {
        chain.hasNonStandardAminoAcids = true;
        chain.nonStandardAminoAcids = Array.from(new Set(nonStandard));
        needsReview = true;
        reviewReason += ` [Non-standard amino acids detected: ${chain.nonStandardAminoAcids.join(', ')}]`;
      }

      // Systematic Fixes - Flag for review instead of forcing changes
      if (chain.type === 'Light') {
        // Position 12 (0-indexed: 11) L -> V potential error
        if (seq.length > 11 && seq[11] === 'L') {
          needsReview = true;
          reviewReason += " [Potential L->V error at pos 12]";
        }
        
        // VL Length Validation
        if (seq.length < 100 || seq.length > 130) {
          needsReview = true;
          reviewReason += ` [VL length anomaly: ${seq.length}]`;
          if (seq.length > 150) {
            reviewReason += " [Likely constant region included]";
          }
        }
      }

      if (chain.type === 'Heavy') {
        // Position 75 (0-indexed: 74) T -> I potential error
        if (seq.length > 74 && seq[74] === 'I') {
          needsReview = true;
          reviewReason += " [Potential T->I error at pos 75]";
        }

        // VH Length Validation
        if (seq.length < 105 || seq.length > 140) {
          needsReview = true;
          reviewReason += ` [VH length anomaly: ${seq.length}]`;
          if (seq.length > 160) {
            reviewReason += " [Likely constant region included]";
          }
        }

        // C-terminal Scrutiny for Heavy Chains (CDR3 region)
        const cTerminal = seq.slice(-25);
        if (cTerminal.includes('L') && !cTerminal.includes('V')) {
          // L is often confused for V in VH framework 4
          needsReview = true;
          reviewReason += " [High risk of L->V OCR substitution in Heavy C-terminus]";
        }
      }

      // Cascading Error Detection (Length Mismatches)
      // Check for common conserved motifs at the end
      const fw4Heavy = "WGQG";
      const fw4Light = "FGQG";
      const endOfSeq = seq.slice(-15);
      if (chain.type === 'Heavy' && !endOfSeq.includes(fw4Heavy) && !endOfSeq.includes("WGRG")) {
        needsReview = true;
        reviewReason += " [Missing conserved Heavy Framework 4 motif: WGQG/WGRG]";
      }
      if (chain.type === 'Light' && !endOfSeq.includes(fw4Light) && !endOfSeq.includes("FGAG") && !endOfSeq.includes("FGTG")) {
        needsReview = true;
        reviewReason += " [Missing conserved Light Framework 4 motif: FGQG/FGTG]";
      }

      return { ...chain, fullSequence: seq };
    });

    // Bispecific Check
    if (mAb.mAbName.toLowerCase().includes('bsab') && mAb.chains.length < 2) {
      needsReview = true;
      reviewReason += " [Bispecific ID detected but potentially missing chains]";
    }

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
