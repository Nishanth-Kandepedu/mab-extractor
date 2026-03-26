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
- SEQ ID NO Mapping: If the text refers to a sequence by its "SEQ ID NO", you MUST find that sequence in the document and extract it.
- Chain Pairing: Ensure that Heavy and Light chains are correctly paired into a single mAb object. If they are listed separately, use their names or context to pair them.
- Handle Fragments: If only CDRs are provided without the full variable region, extract them and note it in the summary.

Self-Correction & Reasoning:
- Before outputting, double-check that every CDR sequence is a 100% match to a substring of the 'fullSequence'.
- Provide a 'reasoning' field explaining how you identified the mAb and paired the chains.
- Perform a 'validation' check to ensure CDRs match the full sequence and chains are paired correctly.

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
      "summary": "string explaining the source and any assumptions made",
      "reasoning": "detailed explanation of the extraction and pairing logic",
      "validation": {
        "cdrsMatchFullSequence": boolean,
        "chainsPairedCorrectly": boolean
      }
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
    parts.push({ text: `Extract ALL mAb sequences from the following text.${contextPrompt}\n\nNote: The data is likely in a table or sequence listing. Ensure EVERY antibody row is captured and paired correctly.\n\n${input}` });
  } else {
    parts.push({
      inlineData: {
        data: input.data,
        mimeType: input.mimeType,
      },
    });
    parts.push({ text: `Extract ALL mAb sequences from this document.${contextPrompt} Pay special attention to tables like 'TABLE 1' or 'Sequence Listing' where multiple antibodies are listed. Capture and pair every single one correctly.` });
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
                    reasoning: { type: Type.STRING },
                    validation: {
                      type: Type.OBJECT,
                      properties: {
                        cdrsMatchFullSequence: { type: Type.BOOLEAN },
                        chainsPairedCorrectly: { type: Type.BOOLEAN },
                      },
                      required: ["cdrsMatchFullSequence", "chainsPairedCorrectly"],
                    },
                  },
                  required: ["mAbName", "chains", "confidence", "summary", "reasoning", "validation"],
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
