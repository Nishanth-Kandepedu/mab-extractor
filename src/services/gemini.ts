import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ExtractionResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const SYSTEM_INSTRUCTION = `You are a world-class bioinformatics expert specializing in antibody sequence extraction from complex patent documents.
Your task is to identify and extract ALL monoclonal antibody (mAb) sequences with 100% precision.

CRITICAL RULES:
1. NO PLACEHOLDERS: NEVER use "...", "[...]", or truncated sequences. Extract full amino acid sequences.
2. HANDLE SPLIT SEQUENCES: Reconstruct sequences by removing spaces/numbers/line breaks.
3. CDR PRECISION: CDRs MUST be exact substrings of the 'fullSequence'.
4. TABLE EXTRACTION: Iterate through EVERY row in tables. Do not skip entries.
5. EXHAUSTIVE SEARCH: Scan the entire document. If there are 30+ antibodies, extract all of them.
6. TOKEN EFFICIENCY: Keep 'reasoning' extremely short (max 30 chars). ONLY include the source location (e.g., "Table 1, Row 4").

Output Schema:
{
  "patentId": "string",
  "patentTitle": "string",
  "isExhaustive": boolean,
  "coverageNote": "string explaining if any sections were skipped",
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
      "reasoning": "string (max 60 chars)",
      "validation": { "cdrsMatchFullSequence": boolean, "chainsPairedCorrectly": boolean }
    }
  ]
}`;

function tryRepairJson(json: string): string {
  try {
    JSON.parse(json);
    return json;
  } catch (e) {
    console.warn("Attempting to repair truncated JSON...");
    let repaired = json.trim();
    
    // Handle unclosed strings
    const lastQuote = repaired.lastIndexOf('"');
    const secondLastQuote = repaired.lastIndexOf('"', lastQuote - 1);
    const isInsideString = (repaired.match(/"/g) || []).length % 2 !== 0;
    
    if (isInsideString) {
      repaired += '"';
    }

    // Remove trailing commas which are common in truncated JSON
    repaired = repaired.replace(/,\s*$/, "");
    
    // Count open/close markers
    const openBraces = (repaired.match(/\{/g) || []).length;
    const closeBraces = (repaired.match(/\}/g) || []).length;
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;

    // Close arrays first, then objects
    for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += ']';
    for (let i = 0; i < openBraces - closeBraces; i++) repaired += '}';
    
    try {
      JSON.parse(repaired);
      return repaired;
    } catch (e2) {
      // If still failing, try to find the last complete antibody object in the array
      // This is a last resort: find the last complete object in the 'antibodies' array
      const lastCompleteObjectMatch = repaired.match(/\{[^{}]*mAbName[^{}]*\}/g);
      if (lastCompleteObjectMatch) {
        const lastValidIndex = repaired.lastIndexOf(lastCompleteObjectMatch[lastCompleteObjectMatch.length - 1]);
        const truncatedArray = repaired.substring(0, lastValidIndex + lastCompleteObjectMatch[lastCompleteObjectMatch.length - 1].length);
        
        // Try to reconstruct the root object
        let fallback = truncatedArray;
        if (!fallback.endsWith(']')) fallback += ']';
        if (!fallback.endsWith('}')) fallback += '}';
        
        // Ensure we have the start of the root object if it was somehow lost (unlikely but safe)
        if (!fallback.startsWith('{')) {
           // This is getting too complex for a simple repair, but let's try one more thing
           return json; 
        }

        try {
          JSON.parse(fallback);
          return fallback;
        } catch (e3) {
          return json;
        }
      }
      return json;
    }
  }
}

export async function extractSequences(
  input: string | { data: string; mimeType: string },
  pageContext?: string
): Promise<ExtractionResult> {
  const model = "gemini-3.1-pro-preview";
  
  let parts: any[] = [];
  const contextPrompt = pageContext ? ` Focus specifically on: ${pageContext}.` : "";
  
  if (typeof input === "string") {
    parts.push({ text: `Extract ALL mAb sequences.${contextPrompt}\n\n${input}` });
  } else {
    parts.push({
      inlineData: {
        data: input.data,
        mimeType: input.mimeType,
      },
    });
    parts.push({ text: `Extract ALL mAb sequences.${contextPrompt} Ensure every antibody row is captured.` });
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
                  required: ["mAbName", "chains", "confidence", "reasoning", "validation"],
                },
              },
            },
            required: ["patentId", "patentTitle", "isExhaustive", "coverageNote", "antibodies"],
          },
        },
      });

      const text = response.text;
      if (!text) throw new Error("No response from AI");
      
      let parsedText = text;
      try {
        JSON.parse(text);
      } catch (e) {
        parsedText = tryRepairJson(text);
      }

      try {
        const result = JSON.parse(parsedText) as ExtractionResult;
        
        // If we repaired it, mark as non-exhaustive and add a note
        if (parsedText !== text) {
          result.isExhaustive = false;
          result.coverageNote = (result.coverageNote || "") + " [Warning: Result was truncated due to length and partially recovered. Use Target Page to extract missing data.]";
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
        console.error("JSON Parse Error on text:", text);
        throw new Error("The AI response was too large and could not be parsed. Please use the 'Target Page / Range' feature to focus on a smaller section of the document.");
      }
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
