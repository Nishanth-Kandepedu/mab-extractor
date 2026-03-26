import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ExtractionResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const SYSTEM_INSTRUCTION = `You are a specialized Antibody Sequence Extractor. Your goal is to find and extract ALL monoclonal antibody (mAb) sequences from patent documents.

CORE RULES:
1. SCOPE: If a specific page, range, or section is provided in the prompt, ONLY extract from that scope. If no scope is given, scan the entire document.
2. EXHAUSTIVE SEARCH: Within the scope, find every single antibody. Look in tables, text descriptions, and sequence listings.
3. TOKEN LIMIT: If there are more than 15 antibodies in the scope, extract ONLY the first 15 and set "isExhaustive": false with a "coverageNote" explaining that more sequences remain.
4. REASONING: Keep the "reasoning" field extremely short (max 30 chars). Just state the source location (e.g., "Table 1, Row 4").
5. OUTPUT: Return ONLY a valid JSON object matching the provided schema. No markdown, no preamble.

EXTRACTION GUIDELINES:
- Capture the mAb Name (e.g., "mAb1", "Antibody A").
- Extract both Heavy and Light chains if available.
- Identify CDRs (CDR1, CDR2, CDR3) and their exact sequences.
- Provide the full variable region sequence for each chain.
- If a sequence is split across lines, join it without spaces.`;

const EXTRACTION_SCHEMA = {
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
                      start: { type: Type.NUMBER },
                      end: { type: Type.NUMBER }
                    },
                    required: ["type", "sequence"]
                  }
                }
              },
              required: ["type", "fullSequence", "cdrs"]
            }
          },
          confidence: { type: Type.NUMBER },
          reasoning: { type: Type.STRING }
        },
        required: ["mAbName", "chains", "confidence", "reasoning"]
      }
    }
  },
  required: ["patentId", "patentTitle", "antibodies"]
};

function tryRepairJson(json: string): string {
  try {
    JSON.parse(json);
    return json;
  } catch (e) {
    console.warn("Attempting to repair truncated JSON...");
    let repaired = json.trim();
    
    // 1. Handle unclosed strings first
    let isInsideString = false;
    for (let i = 0; i < repaired.length; i++) {
      if (repaired[i] === '"' && (i === 0 || repaired[i-1] !== '\\')) {
        isInsideString = !isInsideString;
      }
    }
    if (isInsideString) {
      repaired += '"';
    }

    // 2. Remove trailing commas or partial keys/values
    repaired = repaired.replace(/[,:\[\{\s]+$/, "");
    
    // 3. Stack-based closure
    const stack: string[] = [];
    for (let i = 0; i < repaired.length; i++) {
      const char = repaired[i];
      if (char === '"' && (i === 0 || repaired[i-1] !== '\\')) {
        // Skip string content
        i++;
        while (i < repaired.length && (repaired[i] !== '"' || repaired[i-1] === '\\')) {
          i++;
        }
        continue;
      }
      if (char === '{') stack.push('}');
      if (char === '[') stack.push(']');
      if (char === '}') stack.pop();
      if (char === ']') stack.pop();
    }

    // Close in reverse order
    let closed = repaired;
    const tempStack = [...stack];
    while (tempStack.length > 0) {
      closed += tempStack.pop();
    }
    
    try {
      JSON.parse(closed);
      return closed;
    } catch (e2) {
      // 4. Salvage approach: Find complete antibody objects
      console.warn("Stack-based repair failed, attempting to salvage complete objects...");
      
      const antibodies: any[] = [];
      // Look for objects that have mAbName and chains
      const antibodyRegex = /\{[^{}]*"mAbName"[^]*?"chains"[^]*?\}\s*\}\s*/g;
      
      // This is still hard with regex. Let's try to find the start of the array
      const arrayStart = json.indexOf('"antibodies"');
      if (arrayStart === -1) return json;
      
      const startBracket = json.indexOf('[', arrayStart);
      if (startBracket === -1) return json;
      
      let currentPos = startBracket + 1;
      while (currentPos < json.length) {
        const objectStart = json.indexOf('{', currentPos);
        if (objectStart === -1) break;
        
        // Find matching closing brace for this object
        let braceCount = 0;
        let insideString = false;
        let objectEnd = -1;
        
        for (let i = objectStart; i < json.length; i++) {
          const char = json[i];
          if (char === '"' && (i === 0 || json[i-1] !== '\\')) {
            insideString = !insideString;
          }
          if (!insideString) {
            if (char === '{') braceCount++;
            if (char === '}') {
              braceCount--;
              if (braceCount === 0) {
                objectEnd = i;
                break;
              }
            }
          }
        }
        
        if (objectEnd !== -1) {
          const objectStr = json.substring(objectStart, objectEnd + 1);
          try {
            const obj = JSON.parse(objectStr);
            if (obj.mAbName && obj.chains) {
              antibodies.push(obj);
            }
          } catch (e) {
            // Skip invalid object
          }
          currentPos = objectEnd + 1;
        } else {
          break; // Truncated object
        }
      }
      
      if (antibodies.length > 0) {
        return JSON.stringify({
          patentId: "Unknown (Recovered)",
          patentTitle: "Unknown (Recovered)",
          isExhaustive: false,
          coverageNote: "Partial recovery from truncated response.",
          antibodies: antibodies
        });
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
          responseSchema: EXTRACTION_SCHEMA,
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
        
        // Add raw response for debugging in case of partial data
        result.rawResponse = text;
        
        return result;
      } catch (e) {
        console.error("JSON Parse Error on text:", text);
        const error = new Error("The AI response was too large and could not be parsed. This usually happens when a single page contains a massive number of sequences. Try focusing on a smaller range (e.g., just one specific table or a single page).");
        (error as any).rawResponse = text;
        throw error;
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
