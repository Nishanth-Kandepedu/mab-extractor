import { GoogleGenAI, Type, GenerateContentResponse, ThinkingLevel } from "@google/genai";
import { ExtractionResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const SYSTEM_INSTRUCTION = `You are a high-precision bioinformatics expert specializing in antibody sequence extraction from patent documents. 
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

export async function extractSequences(
  input: string | { data: string; mimeType: string },
  pageContext?: string
): Promise<ExtractionResult> {
  const model = "gemini-3.1-pro-preview";
  
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
    model,
    contents: { parts },
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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
              },
              required: ["mAbName", "chains", "confidence", "summary"],
            },
          },
        },
        required: ["patentId", "patentTitle", "antibodies"],
      },
    },
  });

  let text = response.text;
  if (!text) {
    console.error("Empty response from AI. Usage Metadata:", response.usageMetadata);
    throw new Error("No response from AI. The extraction may have timed out or exceeded token limits.");
  }
  
  // Strip markdown if present
  if (text.includes("```json")) {
    text = text.split("```json")[1].split("```")[0].trim();
  } else if (text.includes("```")) {
    text = text.split("```")[1].split("```")[0].trim();
  }
  
  try {
    const result = JSON.parse(text) as ExtractionResult;
    // Extract usage metadata if available
    if (response.usageMetadata) {
      result.usageMetadata = {
        promptTokenCount: response.usageMetadata.promptTokenCount || 0,
        candidatesTokenCount: response.usageMetadata.candidatesTokenCount || 0,
        totalTokenCount: response.usageMetadata.totalTokenCount || 0,
      };
    }
    return result;
  } catch (e) {
    console.error("Failed to parse AI response. Text length:", text.length);
    console.error("Text preview (last 100 chars):", text.slice(-100));
    console.error("Usage Metadata:", response.usageMetadata);
    throw new Error(`Failed to parse extraction result. The output may have been truncated (Length: ${text.length}).`);
  }
}
