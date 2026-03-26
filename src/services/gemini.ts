import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ExtractionResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const SYSTEM_INSTRUCTION = `You are a world-class bioinformatics expert specializing in antibody sequence extraction from complex patent documents and scientific literature. 
Your task is to identify and extract ALL monoclonal antibody (mAb) sequences mentioned in the document or specific section with 100% precision.

CRITICAL ACCURACY RULES:
1. NO PLACEHOLDERS: NEVER use "...", "[...]", "etc.", or any truncated sequences. You MUST extract the full amino acid sequence exactly as it appears in the text.
2. EXACT MATCHING: Every sequence must be a character-for-character match to the source text.
3. HANDLE SPLIT SEQUENCES: Sequences in PDFs are often split across lines with spaces, numbers, or page breaks. You MUST reconstruct the full sequence by removing any non-amino acid characters (like line numbers or spaces) and joining the parts.
4. CDR PRECISION: CDRs (Complementarity-Determining Regions) MUST be exact substrings of the 'fullSequence' provided for that chain.
5. TABLE EXTRACTION: Patents often list multiple antibodies in large tables (e.g., "Table 1", "Table 5"). You MUST iterate through EVERY row. Do not skip any entries.
6. SEQ ID NO MAPPING: If the text refers to a sequence by its "SEQ ID NO", you MUST find that sequence in the document and extract it.
7. CHAIN PAIRING: Ensure that Heavy and Light chains are correctly paired into a single mAb object. Use mAb names, clone IDs, or contextual proximity to pair them.
8. EXHAUSTIVE SEARCH: Patents can be very long. You MUST scan the entire document. Do not stop after finding the first few antibodies. If there are 30+ antibodies, you must extract all of them.
9. NO TRUNCATION OF LIST: Ensure the 'antibodies' array contains every single antibody found in the document.

Self-Correction & Reasoning:
- Before outputting, perform a "Self-Verification" step:
    - Verify that every CDR sequence is a 100% match to a substring of the 'fullSequence'.
    - Verify that the 'fullSequence' is complete and not truncated.
    - Verify that no antibodies from the source text were missed.
- Provide a 'reasoning' field explaining exactly how you identified the mAb, where you found the sequences (e.g., "Table 3, row 5"), and how you paired the chains. Keep this concise to save output space.
- Perform a 'validation' check to ensure CDRs match the full sequence and chains are paired correctly.

Output Schema:
{
  "patentId": "string",
  "patentTitle": "string",
  "isExhaustive": boolean,
  "coverageNote": "string explaining if any sections were skipped due to length or complexity",
  "antibodies": [
    {
      "mAbName": "string",
      "chains": [
        {
          "type": "Heavy" | "Light",
          "fullSequence": "string (EXACT, NO TRUNCATION)",
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
          maxOutputTokens: 8192,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              patentId: { type: Type.STRING },
              patentTitle: { type: Type.STRING },
              isExhaustive: { type: Type.BOOLEAN },
              coverageNote: { type: Type.STRING },
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
            required: ["patentId", "patentTitle", "isExhaustive", "coverageNote", "antibodies"],
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
