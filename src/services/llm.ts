import { GoogleGenAI, Type, GenerateContentResponse, ThinkingLevel } from "@google/genai";
import { ExtractionResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const SYSTEM_INSTRUCTION = `You are a high-precision bioinformatics expert specializing in antibody sequence extraction from patent documents. 
Your goal is 100% Verbatim Accuracy and 100% Coverage.

Guidelines:
1. ID-Mapping Strategy: First, identify every unique mAb ID (e.g., "mAb 1", "2419"). You MUST extract sequences for every ID found.
2. Chain-by-Chain Verification: Treat every Heavy (VH) and Light (VL) chain as a standalone high-fidelity task. After extracting a sequence, internally re-read the source text to verify every single amino acid.
3. Length-Check Validation: For every sequence extracted, verify that the character count matches the source exactly. Do not truncate or "summarize" sequences to save space.
4. VL Chain Priority: Given the higher historical error rate in VL chains, dedicate extra reasoning cycles to the Light chain variable regions.
5. Source Priority: Always use "Sequence Listings" as the primary source of truth for character accuracy over table text.
6. CDR Identification: Identify CDR1, CDR2, and CDR3 based on standard numbering (IMGT/Kabat).
7. Return the data in the specified JSON format.

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
      "summary": "string"
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
    const result = JSON.parse(text) as ExtractionResult;
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
