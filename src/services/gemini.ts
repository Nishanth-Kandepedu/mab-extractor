import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ExtractionResult, Antibody } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export type ExtractionMode = 'sequences' | 'full';

// Models
const DISCOVERY_MODEL = "gemini-3.1-flash-lite-preview"; // Fast for finding names
const EXTRACTION_MODEL = "gemini-3.1-pro-preview";      // Highest quality for sequences
const ENRICHMENT_MODEL = "gemini-3.1-pro-preview";      // Highest quality for properties

function cleanJson(text: string): string {
  let cleaned = text.trim();
  
  // Remove markdown code blocks if present
  if (cleaned.includes("```")) {
    const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      cleaned = match[1];
    }
  }

  // Find the first '{' or '[' and the last '}' or ']'
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  let start = -1;
  if (firstBrace !== -1 && firstBracket !== -1) {
    start = Math.min(firstBrace, firstBracket);
  } else {
    start = firstBrace !== -1 ? firstBrace : firstBracket;
  }
  
  const lastBrace = cleaned.lastIndexOf('}');
  const lastBracket = cleaned.lastIndexOf(']');
  const end = Math.max(lastBrace, lastBracket);
  
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.substring(start, end + 1);
  }
  
  return cleaned.trim();
}

/**
 * Attempts to fix a truncated JSON string by adding missing closing braces/brackets.
 */
function tryRepairJson(json: string): string {
  let repaired = json.trim();
  
  // Basic check for truncation
  if (!repaired.endsWith('}') && !repaired.endsWith(']')) {
    const stack: string[] = [];
    for (let i = 0; i < repaired.length; i++) {
      const char = repaired[i];
      if (char === '{') stack.push('}');
      else if (char === '[') stack.push(']');
      else if (char === '}' || char === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === char) {
          stack.pop();
        }
      }
    }
    
    while (stack.length > 0) {
      repaired += stack.pop();
    }
  }
  
  return repaired;
}

async function safeJsonParse<T>(text: string): Promise<T> {
  const cleaned = cleanJson(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch (e) {
    try {
      const repaired = tryRepairJson(cleaned);
      return JSON.parse(repaired) as T;
    } catch (repairError) {
      console.error("Failed to parse JSON. Original text:", text);
      // If it's still failing, try one last desperate attempt to find a valid JSON object/array
      try {
        const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (match) {
          return JSON.parse(tryRepairJson(match[0])) as T;
        }
      } catch (finalError) {}
      throw new Error("Invalid JSON response from AI");
    }
  }
}

export async function extractSequences(
  input: string | { data: string; mimeType: string },
  pageContext?: string,
  mode: ExtractionMode = 'sequences',
  onProgress?: (step: string) => void
): Promise<ExtractionResult> {
  let totalUsage = {
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    totalTokenCount: 0
  };

  const contextPrompt = pageContext ? ` Focus specifically on the information found on or near: ${pageContext}.` : "";
  const inputParts = typeof input === "string" 
    ? [{ text: input }] 
    : [{ inlineData: { data: input.data, mimeType: input.mimeType } }];

  // Step 1: Discovery Phase - Find all mAb names
  if (onProgress) onProgress('Discovering all antibodies in the document...');
  
  const discoveryInstruction = `You are a world-class bioinformatics expert. 
Scan the provided document and list EVERY SINGLE monoclonal antibody (mAb) name mentioned.
Be exhaustive. Check:
1. Main text and examples.
2. All tables (especially sequence listing tables or activity tables).
3. Figure captions.
4. Sequence listings (look for "SEQ ID NO" associations with names).

If a name looks like an antibody identifier (e.g., "mAb 1", "Ab-A", "Antibody 12", "14C10"), include it.
Return a JSON object with:
- patentId: string
- patentTitle: string
- mAbNames: string[] (list of all unique mAb names found)`;

  const discResponse: GenerateContentResponse = await ai.models.generateContent({
    model: DISCOVERY_MODEL,
    contents: { parts: [...inputParts, { text: `List all mAb names found in this document. Be exhaustive.${contextPrompt}` }] },
    config: {
      systemInstruction: discoveryInstruction,
      responseMimeType: "application/json",
    }
  });

  if (discResponse.usageMetadata) {
    totalUsage.promptTokenCount += discResponse.usageMetadata.promptTokenCount || 0;
    totalUsage.candidatesTokenCount += discResponse.usageMetadata.candidatesTokenCount || 0;
    totalUsage.totalTokenCount += discResponse.usageMetadata.totalTokenCount || 0;
  }

  const discoveryData = await safeJsonParse<{ patentId: string; patentTitle: string; mAbNames: string[] }>(discResponse.text);
  const mAbNames = Array.from(new Set(discoveryData.mAbNames || [])); // Ensure unique
  
  if (mAbNames.length === 0) {
    return {
      patentId: discoveryData.patentId || "Unknown",
      patentTitle: discoveryData.patentTitle || "Unknown",
      antibodies: [],
      usageMetadata: totalUsage
    };
  }

  if (onProgress) onProgress(`Found ${mAbNames.length} antibodies. Extracting sequences...`);

  // Step 2: Extraction Phase - Extract sequences in batches
  const antibodies: Antibody[] = [];
  const batchSize = 5; // Small batches for high precision
  
  for (let i = 0; i < mAbNames.length; i += batchSize) {
    const currentBatch = mAbNames.slice(i, i + batchSize);
    if (onProgress) onProgress(`Extracting sequences for batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(mAbNames.length/batchSize)} (${currentBatch.join(', ')})...`);

    const extractionInstruction = `You are a world-class bioinformatics expert.
Extract the variable region sequences and CDRs for the following antibodies: [${currentBatch.join(', ')}].

Requirements:
1. Target Name: Identify the target antigen name for each mAb.
2. Sequence Extraction: Extract full variable region sequences for Heavy and Light chains.
3. CDR Identification: Identify CDR1, CDR2, and CDR3 for each chain accurately.
4. Clean sequences: Remove non-amino acid characters.

Return a JSON object with an "antibodies" array matching the requested names.`;

    const extResponse: GenerateContentResponse = await ai.models.generateContent({
      model: EXTRACTION_MODEL,
      contents: { parts: [...inputParts, { text: `Extract sequences for: ${currentBatch.join(', ')}.${contextPrompt}` }] },
      config: {
        systemInstruction: extractionInstruction,
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            antibodies: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  mAbName: { type: Type.STRING },
                  targetName: { type: Type.STRING },
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
          required: ["antibodies"],
        },
      }
    });

    if (extResponse.usageMetadata) {
      totalUsage.promptTokenCount += extResponse.usageMetadata.promptTokenCount || 0;
      totalUsage.candidatesTokenCount += extResponse.usageMetadata.candidatesTokenCount || 0;
      totalUsage.totalTokenCount += extResponse.usageMetadata.totalTokenCount || 0;
    }

    try {
      const extData = await safeJsonParse<{ antibodies: Antibody[] }>(extResponse.text);
      if (extData.antibodies) {
        antibodies.push(...extData.antibodies);
      }
    } catch (e) {
      console.error(`Failed to extract batch starting with ${currentBatch[0]}:`, e);
    }
  }

  const result: ExtractionResult = {
    patentId: discoveryData.patentId || "Unknown",
    patentTitle: discoveryData.patentTitle || "Unknown",
    antibodies,
    usageMetadata: totalUsage
  };

  // Step 3: Enrichment Phase - Extract properties in batches
  if (mode === 'full' && result.antibodies.length > 0) {
    if (onProgress) onProgress(`Enriching properties for ${result.antibodies.length} antibodies...`);
    
    const propBatchSize = 10;
    for (let i = 0; i < result.antibodies.length; i += propBatchSize) {
      const batch = result.antibodies.slice(i, i + propBatchSize);
      const batchNames = batch.map(a => a.mAbName);
      
      if (onProgress) onProgress(`Searching properties for batch ${Math.floor(i/propBatchSize) + 1}/${Math.ceil(result.antibodies.length/propBatchSize)}...`);

      const propertyInstruction = `You are a world-class bioinformatics expert. 
For the antibodies [${batchNames.join(', ')}], perform a DEEP SEARCH for functional data and SAR details.
Search tables and examples for binding data, IC50s, and mutations.

Extract:
1. Target Activity: Binding affinity, IC50, EC50.
2. Functional SAR: Mutation effects.
3. Cell Line: Production host.
4. ADMET/PK: Pharmacokinetics and toxicity.
5. Physicochemical: Tm, pI, stability.
6. Evidence Page: Page number or section.

Return JSON mapping mAb names to properties.`;

      const propResponse: GenerateContentResponse = await ai.models.generateContent({
        model: ENRICHMENT_MODEL,
        contents: { parts: [...inputParts, { text: `Deep search properties for: ${batchNames.join(', ')}.${contextPrompt}` }] },
        config: {
          systemInstruction: propertyInstruction,
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              properties: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    mAbName: { type: Type.STRING },
                    targetActivity: { type: Type.STRING },
                    cellLine: { type: Type.STRING },
                    admet: { type: Type.STRING },
                    pk: { type: Type.STRING },
                    physchem: { type: Type.STRING },
                    functionalSAR: { type: Type.STRING },
                    otherProperties: { type: Type.STRING },
                    evidencePage: { type: Type.STRING },
                  },
                  required: ["mAbName"],
                }
              }
            },
            required: ["properties"],
          },
        }
      });

      if (propResponse.usageMetadata) {
        totalUsage.promptTokenCount += propResponse.usageMetadata.promptTokenCount || 0;
        totalUsage.candidatesTokenCount += propResponse.usageMetadata.candidatesTokenCount || 0;
        totalUsage.totalTokenCount += propResponse.usageMetadata.totalTokenCount || 0;
      }

      try {
        const propData = await safeJsonParse<{ properties: any[] }>(propResponse.text);
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        result.antibodies = result.antibodies.map(mAb => {
          const props = propData.properties?.find(p => normalize(p.mAbName) === normalize(mAb.mAbName));
          if (props) {
            const { mAbName, ...rest } = props;
            return { ...mAb, properties: { ...mAb.properties, ...rest } };
          }
          return mAb;
        });
      } catch (e) {
        console.warn("Failed to parse property response for batch:", e);
      }
    }
  }

  return result;
}
