import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ExtractionResult, Antibody, ExtractionTier, AntibodyProperties } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export type ExtractionMode = 'sequences' | 'full';

// Model Mapping
const MODELS = {
  fast: {
    discovery: "gemini-3.1-flash-lite-preview",
    extraction: "gemini-3.1-flash-lite-preview",
    enrichment: "gemini-3.1-flash-lite-preview"
  },
  balanced: {
    discovery: "gemini-3.1-flash-lite-preview",
    extraction: "gemini-3-flash-preview",
    enrichment: "gemini-3-flash-preview"
  },
  extended: {
    discovery: "gemini-3.1-flash-lite-preview",
    extraction: "gemini-3.1-pro-preview",
    enrichment: "gemini-3.1-pro-preview"
  }
};

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
  tier: ExtractionTier = 'balanced',
  onProgress?: (step: string) => void
): Promise<ExtractionResult> {
  let totalUsage = {
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    totalTokenCount: 0
  };

  const tierModels = MODELS[tier];
  const contextPrompt = pageContext ? ` Focus specifically on the information found on or near: ${pageContext}.` : "";
  const inputParts = typeof input === "string" 
    ? [{ text: input }] 
    : [{ inlineData: { data: input.data, mimeType: input.mimeType } }];

  // Step 1: Discovery Phase - Find all mAb names
  if (onProgress) onProgress('Discovering all antibodies in the document...');
  
  const discoveryInstruction = `You are a world-class bioinformatics expert specializing in antibody patent analysis.
Analyze the provided patent document and identify all unique monoclonal antibodies (mAbs) mentioned.

Requirements:
1. List every unique mAb name or identifier (e.g., "Ab1", "mAb-X", "12C4").
2. For each mAb, identify the associated SEQ ID NOs for Heavy (VH) and Light (VL/VK) chain variable regions if mentioned.
3. Identify the primary target antigen name.

Return a JSON object with a "mAbs" array.`;

  const discResponse: GenerateContentResponse = await ai.models.generateContent({
    model: tierModels.discovery,
    contents: { parts: [...inputParts, { text: `Identify all monoclonal antibodies and their associated SEQ ID NOs.${contextPrompt}` }] },
    config: {
      systemInstruction: discoveryInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          mAbs: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                target: { type: Type.STRING },
                seqIdHeavy: { type: Type.STRING, description: "SEQ ID NO for Heavy chain variable region" },
                seqIdLight: { type: Type.STRING, description: "SEQ ID NO for Light chain variable region" },
                hasSequences: { type: Type.BOOLEAN },
              },
              required: ["name", "hasSequences"],
            },
          },
          patentId: { type: Type.STRING },
          patentTitle: { type: Type.STRING },
        },
        required: ["mAbs"],
      },
    }
  });

  if (discResponse.usageMetadata) {
    totalUsage.promptTokenCount += discResponse.usageMetadata.promptTokenCount || 0;
    totalUsage.candidatesTokenCount += discResponse.usageMetadata.candidatesTokenCount || 0;
    totalUsage.totalTokenCount += discResponse.usageMetadata.totalTokenCount || 0;
  }

    const discoveryData = await safeJsonParse<{ patentId: string; patentTitle: string; mAbs: any[] }>(discResponse.text);
    const mAbsInfo = discoveryData.mAbs || [];
    const mAbNames = mAbsInfo.map((m: any) => m.name);
    const mAbHints = mAbsInfo.map((m: any) => `${m.name}: Heavy SEQ ID ${m.seqIdHeavy || 'unknown'}, Light SEQ ID ${m.seqIdLight || 'unknown'}`).join('; ');
    
    if (mAbNames.length === 0) {
      return {
        patentId: discoveryData.patentId || "Unknown",
        patentTitle: discoveryData.patentTitle || "Unknown",
        antibodies: [],
        usageMetadata: totalUsage,
        tier
      };
    }

    if (onProgress) onProgress(`Found ${mAbNames.length} antibodies. Extracting sequences...`);

    // Step 2: Extraction Phase - Extract sequences in batches
    const antibodies: Antibody[] = [];
    const batchSize = tier === 'extended' ? 3 : (tier === 'fast' ? 10 : 5); // Even smaller batches for Extended tier to ensure absolute precision
    
    for (let i = 0; i < mAbNames.length; i += batchSize) {
      const currentBatch = mAbNames.slice(i, i + batchSize);
      const currentBatchHints = mAbsInfo
        .filter((m: any) => currentBatch.includes(m.name))
        .map((m: any) => `${m.name} (Heavy SEQ ID: ${m.seqIdHeavy || 'N/A'}, Light SEQ ID: ${m.seqIdLight || 'N/A'})`)
        .join('; ');

      if (onProgress) onProgress(`Extracting sequences for batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(mAbNames.length/batchSize)} (${currentBatch.join(', ')})...`);

      const extractionInstruction = `You are a world-class bioinformatics expert specializing in antibody sequence extraction from patents.
Your task is to extract the EXACT variable region sequences and CDRs for the following antibodies: [${currentBatch.join(', ')}].

HINTS FOR THIS BATCH:
${currentBatchHints}

CRITICAL REQUIREMENTS FOR VERBATIM ACCURACY:
1. VERBATIM EXTRACTION: You MUST copy sequences character-by-character from the source. DO NOT summarize, DO NOT guess, and DO NOT "fix" sequences. A single character error is a total failure.
2. SEQUENCE CLEANING: Patent documents often include line numbers (e.g., 10, 20, 30) and spaces within sequence listings. You MUST ignore these numbers and spaces, but you MUST NOT miss any amino acid characters (A, C, D, E, F, G, H, I, K, L, M, N, P, Q, R, S, T, V, W, Y).
3. CHAIN DIFFERENTIATION: Carefully distinguish between Heavy (VH) and Light (VL, VK, or Vλ) chains. Use the SEQ ID NO hints provided to find the correct sequences.
4. CDR IDENTIFICATION: Use standard Kabat/Chothia logic. CDR sequences MUST be exact substrings of the full variable region sequence you extracted.
5. TARGET IDENTIFICATION: Identify the specific target antigen for each mAb.
6. METADATA: Extract Company, Country, Indication, and Molecule Number if explicitly stated.

DOUBLE-CHECK: Before finalizing the JSON, verify that every single amino acid in your extracted sequence matches the source document exactly.

Return a JSON object with an "antibodies" array matching the requested names.`;

      const extResponse: GenerateContentResponse = await ai.models.generateContent({
        model: tierModels.extraction,
        contents: { parts: [...inputParts, { text: `Extract sequences for: ${currentBatch.join(', ')}. Hints: ${currentBatchHints}.${contextPrompt} Ensure 100% verbatim accuracy.` }] },
      config: {
        systemInstruction: extractionInstruction,
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
        temperature: 0, // Set temperature to 0 for maximum deterministic accuracy
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
                  properties: {
                    type: Type.OBJECT,
                    properties: {
                      company: { type: Type.STRING },
                      country: { type: Type.STRING },
                      indication: { type: Type.STRING },
                      moleculeNumber: { type: Type.STRING },
                      mabType: { type: Type.STRING },
                      mabSpecies: { type: Type.STRING },
                      mabFormat: { type: Type.STRING },
                      targetSpecies: { type: Type.STRING },
                      sequenceReference: { type: Type.STRING },
                    }
                  }
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
    usageMetadata: totalUsage,
    tier
  };

  // Step 3: Enrichment Phase - Extract properties in batches
  if (mode === 'full' && result.antibodies.length > 0) {
    if (onProgress) onProgress(`Enriching properties for ${result.antibodies.length} antibodies...`);
    
    const propBatchSize = tier === 'fast' ? 15 : 10;
    for (let i = 0; i < result.antibodies.length; i += propBatchSize) {
      const batch = result.antibodies.slice(i, i + propBatchSize);
      const batchNames = batch.map(a => a.mAbName);
      
      if (onProgress) onProgress(`Searching properties for batch ${Math.floor(i/propBatchSize) + 1}/${Math.ceil(result.antibodies.length/propBatchSize)}...`);

      const propertyInstruction = `You are a world-class bioinformatics expert specializing in antibody pharmacology.
For the following antibodies: [${batchNames.join(', ')}], extract detailed functional and pharmacological properties from the patent.

CRITICAL INSTRUCTIONS:
1. STRUCTURE-ACTIVITY RELATIONSHIP (SAR): This is the most important field. Look for tables or text describing mutations, affinity changes, or binding kinetics. You MUST present this as a structured table-like string using segments (e.g., "Mutation | Effect | Value"). If no SAR is found, state "No SAR data identified in document."
2. BINDING & FUNCTIONAL ACTIVITY: Extract specific values (EC50, KD, IC50) and the assay used.
3. ADMET & PK: Look for half-life, clearance, volume of distribution, and toxicity data.
4. PHYSICOCHEMICAL: Extract stability, aggregation, and solubility data.
5. EVIDENCE: Always cite the specific page, table, or paragraph where the data was found.

Return a JSON object with a "properties" array.`;

      const propResponse: GenerateContentResponse = await ai.models.generateContent({
        model: tierModels.enrichment,
        contents: { parts: [...inputParts, { text: `Extract all properties and SAR for: ${batchNames.join(', ')}.${contextPrompt}` }] },
        config: {
          systemInstruction: propertyInstruction,
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
          temperature: 0,
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
                    bindingActivity: { type: Type.STRING, enum: ["Yes", "No"] },
                    pkActivity: { type: Type.STRING, enum: ["Yes", "No"] },
                    functionalActivity: { type: Type.STRING, enum: ["Yes", "No"] },
                    expressionSystem: { type: Type.STRING, enum: ["Yes", "No"] },
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
