import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ExtractionResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const SYSTEM_INSTRUCTION = `You are a world-class bioinformatics expert specializing in antibody sequence extraction from complex patent documents and scientific literature. 
Your task is to identify and extract ALL monoclonal antibody (mAb) sequences mentioned in the document or specific section with 100% precision.

Core Objectives:
1. Identify every unique antibody (mAb) mentioned.
2. For each mAb, extract the Heavy Chain (VH) and Light Chain (VL) variable regions.
3. For each chain, precisely identify the Complementarity-Determining Regions (CDRs): CDR1, CDR2, and CDR3.

Accuracy Guidelines:
- Sequence Integrity: Do not truncate sequences. Capture the full variable region from the start of Framework 1 (FR1) to the end of Framework 4 (FR4).
- CDR Boundaries: Use standard numbering schemes (IMGT is preferred). Look for conserved motifs:
    - Heavy Chain: CDR3 is typically preceded by 'C-A-R' or 'C-T-R' and followed by 'W-G-Q-G'.
    - Light Chain: CDR3 is typically preceded by 'C' and followed by 'F-G-Q-G' or 'F-G-G-G'.
- Table Extraction: Patents often list multiple antibodies in large tables (e.g., "Table 1", "Table 5"). You MUST iterate through EVERY row. Do not skip any entries.
- Context Awareness: If a patent describes "Antibody A" and "Antibody B", ensure they are extracted as separate objects.
- Handle Fragments: If only CDRs are provided without the full variable region, extract them and note it in the summary.

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
      "confidence": number (0-1),
      "summary": "string explaining the source and any assumptions made"
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
    parts.push({ text: `Extract ALL mAb sequences from the following text.${contextPrompt}\n\nNote: The data is likely in a table. Ensure EVERY antibody row is captured.\n\n${input}` });
  } else {
    parts.push({
      inlineData: {
        data: input.data,
        mimeType: input.mimeType,
      },
    });
    parts.push({ text: `Extract ALL mAb sequences from this document.${contextPrompt} Pay special attention to tables like 'TABLE 1' where multiple antibodies are listed. Capture every single one.` });
  }

  let attempts = 0;
  const maxAttempts = 3;
  let lastError: any = null;

  while (attempts < maxAttempts) {
    try {
      const response: GenerateContentResponse = await ai.models.generateContent({
        model,
        contents: { parts },
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
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
      
      const result = JSON.parse(text) as ExtractionResult;
      if (response.usageMetadata) {
        result.usageMetadata = {
          promptTokenCount: response.usageMetadata.promptTokenCount || 0,
          candidatesTokenCount: response.usageMetadata.candidatesTokenCount || 0,
          totalTokenCount: response.usageMetadata.totalTokenCount || 0,
        };
      }
      return result;
    } catch (e: any) {
      lastError = e;
      // Check if it's a 503 error
      if (e.message?.includes("503") || e.message?.includes("UNAVAILABLE")) {
        attempts++;
        if (attempts < maxAttempts) {
          console.warn(`Gemini API 503 error, retrying attempt ${attempts}...`);
          await new Promise(resolve => setTimeout(resolve, 2000 * attempts)); // Exponential backoff
          continue;
        }
      }
      break;
    }
  }

  console.error("Failed to extract sequences after retries:", lastError);
  throw new Error(lastError instanceof Error ? lastError.message : "Extraction failed");
}
