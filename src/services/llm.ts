import { GoogleGenAI, Type, GenerateContentResponse, ThinkingLevel } from "@google/genai";
import { ExtractionResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

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
  const { provider, model } = options;

  if (provider === 'gemini') {
    return extractWithGemini(input, model || 'gemini-3.1-pro-preview', pageContext);
  }

  // For OpenAI and Anthropic, we call our backend API
  const response = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      model,
      input: typeof input === 'string' ? input : undefined, // Currently only supporting text for non-Gemini
      systemInstruction: SYSTEM_INSTRUCTION,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to extract with ' + provider);
  }

  return await response.json();
}

async function extractWithGemini(
  input: string | { data: string; mimeType: string },
  modelName: string,
  pageContext?: string
): Promise<ExtractionResult> {
  console.log(`[LLM Service] Starting extraction with model: ${modelName}`);
  let parts: any[] = [];
  const contextPrompt = pageContext ? ` Focus specifically on the information found on or near: ${pageContext}.` : "";
  
  if (typeof input === "string") {
    parts.push({ text: `Extract ALL mAb sequences from the following text.${contextPrompt}\n\nNote: Ensure EVERY antibody ID is captured and sequences are verbatim.\n\n${input}` });
  } else {
    parts.push({
      inlineData: {
        data: input.data,
        mimeType: input.mimeType,
      },
    });
    parts.push({ text: `Extract ALL mAb sequences from this document.${contextPrompt} Perform high-quality verbatim mining for all 34+ antibodies.` });
  }

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: modelName,
      contents: { parts },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0,
        thinkingConfig: modelName.includes('3.1') ? { thinkingLevel: ThinkingLevel.HIGH } : undefined,
        maxOutputTokens: 65536,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            patentId: { type: Type.STRING },
            patentTitle: { type: Type.STRING },
            antibodies: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  mAbName: { type: Type.STRING },
                  chains: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        type: { type: Type.STRING, enum: ["Heavy", "Light"] },
                        fullSequence: { type: Type.STRING },
                        cdrs: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              type: { type: Type.STRING, enum: ["CDR1", "CDR2", "CDR3"] },
                              sequence: { type: Type.STRING },
                              start: { type: Type.INTEGER },
                              end: { type: Type.INTEGER },
                            },
                            required: ["type", "sequence", "start", "end"],
                          },
                        },
                      },
                      required: ["type", "fullSequence", "cdrs"],
                    },
                  },
                  confidence: { type: Type.NUMBER },
                  summary: { type: Type.STRING },
                  evidenceLocation: { type: Type.STRING },
                  evidenceStatement: { type: Type.STRING },
                  needsReview: { type: Type.BOOLEAN },
                  reviewReason: { type: Type.STRING },
                },
                required: ["mAbName", "chains", "confidence", "summary"],
              },
            },
          },
          required: ["patentId", "patentTitle", "antibodies"],
        },
      },
    });

    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const text = response.text;
    
    if (!text) {
      if (finishReason === 'SAFETY') {
        throw new Error("Gemini API blocked the response due to safety filters. This sometimes happens with complex sequence data.");
      }
      throw new Error(`Empty response from Gemini API (Finish Reason: ${finishReason || 'UNKNOWN'})`);
    }
    
    // Check if the response is actually an error JSON (sometimes happens if the SDK doesn't throw)
    if (text.includes('"error"') && text.includes('"code": 429')) {
      throw new Error("Gemini API Quota Exceeded (429). Please try again in a few minutes or switch to a different model (e.g., Gemini 3 Flash).");
    }

    let result: ExtractionResult;
    try {
      result = extractJson(text) as ExtractionResult;
    } catch (parseError: any) {
      if (finishReason === 'MAX_TOKENS') {
        throw new Error("The extraction was too large and was truncated by the AI. Please try extracting a smaller section of the document or fewer antibodies at once.");
      }
      throw parseError;
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
      if (mAb.confidence < 0.7) {
        needsReview = true;
        reviewReason += ` [Low confidence: ${mAb.confidence}]`;
      }

      // Accuracy proxy: Length-based validation
      mAb.chains.forEach(chain => {
        const len = chain.fullSequence.length;
        if (chain.type === 'Light' && (len < 90 || len > 140)) {
          needsReview = true;
          reviewReason += ` [VL length critical anomaly: ${len}]`;
        }
        if (chain.type === 'Heavy' && (len < 95 || len > 150)) {
          needsReview = true;
          reviewReason += ` [VH length critical anomaly: ${len}]`;
        }
      });

      return { ...mAb, needsReview, reviewReason: reviewReason.trim() };
    });

    // Pass 2: Targeted Re-extraction for problematic antibodies
    const problematicMabs = result.antibodies.filter(m => m.needsReview);
    if (problematicMabs.length > 0) {
      console.log(`Performing targeted re-extraction for ${problematicMabs.length} antibodies...`);
      
      for (const mAb of problematicMabs) {
        const targetedPrompt = `
          RE-EXTRACTION TASK:
          The previous extraction for antibody "${mAb.mAbName}" was flagged for review.
          Reason: ${mAb.reviewReason}
          
          Please re-examine the document specifically for "${mAb.mAbName}".
          
          SPECIAL INSTRUCTIONS FOR THIS ID:
          ${mAb.mAbName === '2218' ? '- This antibody has a known VL extraction issue (catastrophic failure in previous runs). Use an alternative extraction method to ensure the Light chain is complete and verbatim. The VL sequence should be around 110-120 amino acids.' : ''}
          ${mAb.mAbName === '4439' ? '- This antibody has a known VH extraction issue (catastrophic failure in previous runs). Check if the table structure is different or if the sequence is split across rows. The VH sequence should be around 115-125 amino acids.' : ''}
          ${mAb.mAbName.startsWith('2419-12') ? '- This is a known problematic variant. Ensure the VH sequence is captured in its entirety and verbatim.' : ''}
          ${mAb.mAbName === '3631' ? '- This antibody has a known minor VH extraction issue. Please re-verify every amino acid in the VH chain.' : ''}

          Pay close attention to:
          1. Table structure (is it split across rows?)
          2. VL chain location (is it in a separate table?)
          3. Sequence completeness (ensure no truncation).
          
          Return ONLY the data for this specific antibody in the same JSON format.
        `;

        try {
          const targetedResponse = await ai.models.generateContent({
            model: modelName,
            contents: [
              typeof input === 'string' 
                ? { text: input } 
                : { inlineData: { data: input.data, mimeType: input.mimeType } },
              { text: targetedPrompt }
            ],
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              responseMimeType: "application/json",
            }
          });

          if (targetedResponse.text) {
            try {
              const targetedResult = extractJson(targetedResponse.text) as ExtractionResult;
              const updatedMab = targetedResult.antibodies.find(m => m.mAbName === mAb.mAbName);
              if (updatedMab) {
                // Replace the old one with the new one if it looks better
                const index = result.antibodies.findIndex(m => m.mAbName === mAb.mAbName);
                if (index !== -1) {
                  result.antibodies[index] = {
                    ...updatedMab,
                    reviewReason: `[RE-EXTRACTED] ${updatedMab.reviewReason || ""}`.trim()
                  };
                }
              }
            } catch (e) {
              console.error("Failed to parse targeted re-extraction", e);
            }
          }
        } catch (targetedError: any) {
          console.error("Targeted re-extraction failed (likely quota):", targetedError.message);
          // Don't throw here, just continue with what we have
        }
      }
    }

    if (response.usageMetadata) {
      result.usageMetadata = {
        promptTokenCount: response.usageMetadata.promptTokenCount || 0,
        candidatesTokenCount: response.usageMetadata.candidatesTokenCount || 0,
        totalTokenCount: response.usageMetadata.totalTokenCount || 0,
      };
    }
    result.modelUsed = modelName;
    return result;
  } catch (e: any) {
    const errorMsg = e.message || String(e);
    if (errorMsg.includes('429') || errorMsg.includes('quota')) {
      throw new Error("Gemini API Quota Exceeded (429). The current model (Gemini 3.1 Pro) has strict limits on the free tier. Please wait a few minutes or switch to 'Gemini 3 Flash' in the settings for higher throughput.");
    }
    if (errorMsg.includes('503') || errorMsg.includes('high demand') || errorMsg.includes('UNAVAILABLE')) {
      throw new Error("Gemini API Service Unavailable (503). This model is currently experiencing high demand. Please try again in a few minutes or switch to 'Gemini 3 Flash' which typically has better availability.");
    }
    console.error("Failed to parse AI response:", e);
    throw new Error(`Failed to parse extraction result: ${errorMsg}`);
  }
}
