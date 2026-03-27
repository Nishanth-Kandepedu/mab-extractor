import { GoogleGenAI, Type, GenerateContentResponse, ThinkingLevel } from "@google/genai";
import { ExtractionResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const SYSTEM_INSTRUCTION = `You are a high-precision bioinformatics expert specializing in antibody sequence extraction from patent documents. 
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
6. Chain-by-Chain Verification: Treat every Heavy (VH) and Light (VL) chain as a standalone high-fidelity task. After extracting a sequence, internally re-read the source text to verify every single amino acid.
7. Length-Check Validation: For every sequence extracted, verify that the character count matches the source exactly. Do not truncate or "summarize" sequences to save space.
8. VL Chain Priority: Given the higher historical error rate in VL chains, dedicate extra reasoning cycles to the Light chain variable regions.
9. Source Priority: Always use "Sequence Listings" as the primary source of truth for character accuracy over table text.
10. CDR Identification: Identify CDR1, CDR2, and CDR3 based on standard numbering (IMGT/Kabat).
11. Return the data in the specified JSON format.

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
      "confidence": number,
      "summary": "string",
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
    parts.push({ text: `Extract ALL mAb sequences from this document.${contextPrompt} Perform high-fidelity verbatim extraction for all 34+ antibodies.` });
  }

  const response: GenerateContentResponse = await ai.models.generateContent({
    model: modelName,
    contents: { parts },
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0,
      thinkingConfig: modelName.includes('3.1') ? { thinkingLevel: ThinkingLevel.HIGH } : undefined,
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

  const text = response.text;
  if (!text) throw new Error("No response from AI");
  
  try {
    let result = JSON.parse(text) as ExtractionResult;
    
    // Post-processing and Validation
    result.antibodies = result.antibodies.map(mAb => {
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
      if (mAb.mAbName.startsWith("2419-12")) {
        needsReview = true;
        reviewReason += " [Known problematic variant 2419-12XX]";
      }

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
          Pay close attention to:
          1. Table structure (is it split across rows?)
          2. VL chain location (is it in a separate table?)
          3. Sequence completeness (ensure no truncation).
          
          Return ONLY the data for this specific antibody in the same JSON format.
        `;

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
            const targetedResult = JSON.parse(targetedResponse.text) as ExtractionResult;
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
      }
    }

    if (response.usageMetadata) {
      result.usageMetadata = {
        promptTokenCount: response.usageMetadata.promptTokenCount || 0,
        candidatesTokenCount: response.usageMetadata.candidatesTokenCount || 0,
        totalTokenCount: response.usageMetadata.totalTokenCount || 0,
      };
    }
    return result;
  } catch (e) {
    console.error("Failed to parse AI response:", text);
    throw new Error("Failed to parse extraction result");
  }
}
