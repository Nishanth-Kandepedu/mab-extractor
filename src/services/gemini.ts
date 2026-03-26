import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ExtractionResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const SYSTEM_INSTRUCTION = `You are a specialized Antibody Sequence Extractor. Your goal is to find and extract monoclonal antibody (mAb) sequences from patent documents.

CORE RULES:
1. SCOPE: If a specific page, range, or section is provided, ONLY extract from that scope.
2. LIMIT: Extract a maximum of 30 antibodies per response. If more exist, set "isExhaustive": false and note this in "coverageNote".
3. CONCISENESS: Keep "reasoning" extremely short (e.g., "Table 1"). Do not include unnecessary text.
4. FORMAT: Return ONLY a valid JSON object. No markdown, no preamble.

EXTRACTION GUIDELINES:
- Capture mAb Name.
- Extract Heavy and Light chains.
- Identify CDRs (type, sequence, start/end).
- Provide full variable region sequence.
- Join split sequences without spaces.`;

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
    console.warn("Attempting to repair/salvage JSON...");
    let text = json.trim();
    
    // 1. Try to find the JSON block if it's wrapped in markdown
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      text = jsonMatch[1] || jsonMatch[0];
    }

    // 2. Salvage approach: Find any objects that look like antibodies
    const antibodies: any[] = [];
    const mAbNameIndices: number[] = [];
    let pos = text.indexOf('"mAbName"');
    while (pos !== -1) {
      mAbNameIndices.push(pos);
      pos = text.indexOf('"mAbName"', pos + 1);
    }

    for (const startPos of mAbNameIndices) {
      let objectStart = text.lastIndexOf('{', startPos);
      if (objectStart === -1) continue;

      let braceCount = 0;
      let insideString = false;
      let objectEnd = -1;
      
      for (let i = objectStart; i < text.length; i++) {
        const char = text[i];
        if (char === '"' && (i === 0 || text[i-1] !== '\\')) {
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
        const objectStr = text.substring(objectStart, objectEnd + 1);
        try {
          const obj = JSON.parse(objectStr);
          if (obj.mAbName && obj.chains) {
            if (!antibodies.some(a => a.mAbName === obj.mAbName && JSON.stringify(a.chains) === JSON.stringify(obj.chains))) {
              antibodies.push(obj);
            }
          }
        } catch (e) {
          // Skip invalid object
        }
      }
    }

    if (antibodies.length > 0) {
      const patentIdMatch = text.match(/"patentId"\s*:\s*"([^"]+)"/);
      const patentTitleMatch = text.match(/"patentTitle"\s*:\s*"([^"]+)"/);

      return JSON.stringify({
        patentId: patentIdMatch ? patentIdMatch[1] : "Unknown (Recovered)",
        patentTitle: patentTitleMatch ? patentTitleMatch[1] : "Unknown (Recovered)",
        isExhaustive: false,
        coverageNote: "The AI response was truncated due to its size, but we successfully salvaged " + antibodies.length + " antibodies. Try focusing on a smaller page range if you need more data.",
        antibodies: antibodies
      });
    }
    
    return json;
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
      if (!text) throw new Error("The AI returned an empty response. This can happen with extremely complex pages. Try focusing on a smaller section.");
      
      let parsedText = text;
      try {
        JSON.parse(text);
      } catch (e) {
        parsedText = tryRepairJson(text);
      }

      try {
        const result = JSON.parse(parsedText) as ExtractionResult;
        
        if (parsedText !== text) {
          result.isExhaustive = false;
          result.coverageNote = (result.coverageNote || "") + " [Note: The AI response was truncated due to length. We recovered " + (result.antibodies?.length || 0) + " sequences.]";
        }

        if (response.usageMetadata) {
          result.usageMetadata = {
            promptTokenCount: response.usageMetadata.promptTokenCount || 0,
            candidatesTokenCount: response.usageMetadata.candidatesTokenCount || 0,
            totalTokenCount: response.usageMetadata.totalTokenCount || 0,
          };
        }
        
        result.rawResponse = text;
        
        return result;
      } catch (e) {
        console.error("JSON Parse Error on text:", text);
        const error = new Error("[v2.1] The AI response was too complex to parse automatically. This happens when a document section contains an extreme amount of data. Try focusing on a single table or a smaller page range.");
        (error as any).rawResponse = text;
        throw error;
      }
    } catch (e: any) {
      lastError = e;
      // Handle specific API errors
      if (e.message?.includes("400") || e.message?.includes("INVALID_ARGUMENT")) {
        throw new Error("The request was rejected by the AI because the document section is too large or complex. Please use the 'Target Page / Range' feature to focus on a smaller part of the patent.");
      }
      if (e.message?.includes("503") || e.message?.includes("UNAVAILABLE")) {
        attempts++;
        if (attempts < maxAttempts) {
          console.warn(`Gemini API 503 error, retrying attempt ${attempts}...`);
          await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
          continue;
        }
      }
      break;
    }
  }

  console.error("Failed to extract sequences after retries:", lastError);
  throw new Error(lastError instanceof Error ? lastError.message : "Extraction failed");
}
