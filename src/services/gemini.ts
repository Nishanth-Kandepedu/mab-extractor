import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ExtractionResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export type ExtractionMode = 'sequences' | 'full';

function cleanJson(text: string): string {
  // Remove markdown code blocks if present
  let cleaned = text.trim();
  if (cleaned.includes("```")) {
    const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      cleaned = match[1];
    }
  }
  return cleaned.trim();
}

export async function extractSequences(
  input: string | { data: string; mimeType: string },
  pageContext?: string,
  mode: ExtractionMode = 'sequences',
  onProgress?: (step: string) => void
): Promise<ExtractionResult> {
  const model = "gemini-3.1-pro-preview";
  
  // Step 1: Extract Sequences (Exhaustive Pass)
  if (onProgress) onProgress('Identifying all antibodies and extracting sequences (Exhaustive Pass)...');
  
  const sequenceInstruction = `You are a world-class bioinformatics expert specializing in patent analysis. 
Your goal is to identify EVERY SINGLE monoclonal antibody (mAb) mentioned in the document.

CRITICAL: Do not be lazy. If the patent describes 50 antibodies, you must return 50 antibodies. 
Check every table, every figure caption, and every example. 
If the document contains a "Sequence Listing" section (e.g., WIPO ST.25 or ST.26), prioritize extracting sequences from there.

Extraction Requirements:
1. mAb Identification: Find all unique mAbs. Do not skip any.
2. Target Name: Identify the target antigen name for each mAb (e.g., HER2, PD-1, IL-6).
3. Sequence Extraction: For each mAb, extract the full variable region sequence for both Heavy and Light chains.
4. CDR Identification: Identify CDR1, CDR2, and CDR3 for each chain accurately (IMGT, Kabat, or Chothia).
5. Metadata: Provide Patent ID and Patent Title.
6. Clean sequences: Remove any non-amino acid characters (spaces, numbers, etc.).

Guidelines:
- Iterate through ALL tables, figures, and text sections.
- Ensure the mAbName is the primary identifier used in the patent.
- If a mAb is only mentioned in a table, extract it from there.
- Return valid JSON matching the schema. If no antibodies are found, return an empty array for antibodies but still provide patentId and patentTitle if possible.`;

  let parts: any[] = [];
  const contextPrompt = pageContext ? ` Focus specifically on the information found on or near: ${pageContext}.` : "";
  
  if (typeof input === "string") {
    parts.push({ text: `Extract ALL mAb sequences from the following text. Be exhaustive.${contextPrompt}\n\n${input}` });
  } else {
    parts.push({
      inlineData: {
        data: input.data,
        mimeType: input.mimeType,
      },
    });
    parts.push({ text: `Extract ALL mAb sequences from this document. Search every page and table. Be exhaustive.${contextPrompt}` });
  }

  const seqResponse: GenerateContentResponse = await ai.models.generateContent({
    model,
    contents: { parts },
    config: {
      systemInstruction: sequenceInstruction,
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
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
        required: ["patentId", "patentTitle", "antibodies"],
      },
    },
  });

  const seqText = seqResponse.text;
  if (!seqText) throw new Error("No response from AI during sequence extraction");
  
  let result: ExtractionResult;
  try {
    const cleaned = cleanJson(seqText);
    result = JSON.parse(cleaned) as ExtractionResult;
    if (seqResponse.usageMetadata) {
      result.usageMetadata = {
        promptTokenCount: seqResponse.usageMetadata.promptTokenCount || 0,
        candidatesTokenCount: seqResponse.usageMetadata.candidatesTokenCount || 0,
        totalTokenCount: seqResponse.usageMetadata.totalTokenCount || 0,
      };
    }
  } catch (e) {
    console.error("Failed to parse sequence response. Raw text:", seqText);
    throw new Error(`Failed to parse sequence extraction result. The model might have returned an invalid format or exceeded its output limit.`);
  }

  // Step 2: Enrich Properties if mode is 'full' (Deep Pass)
  if (mode === 'full' && result.antibodies.length > 0) {
    if (onProgress) onProgress(`Performing deep search for SAR and functional data for ${result.antibodies.length} antibodies...`);
    
    // Process in batches if there are many antibodies to avoid context limits or timeouts
    const batchSize = 10;
    for (let i = 0; i < result.antibodies.length; i += batchSize) {
      const batch = result.antibodies.slice(i, i + batchSize);
      const mAbNames = batch.map(a => a.mAbName).join(', ');
      
      if (onProgress) onProgress(`Enriching properties for batch ${Math.floor(i/batchSize) + 1} (${mAbNames})...`);

      const propertyInstruction = `You are a world-class bioinformatics expert. 
For the monoclonal antibodies [${mAbNames}], perform a DEEP SEARCH for functional data and Structure-Activity Relationship (SAR) details in the provided document.

CRITICAL: Be exhaustive. Search every table and example for binding data, IC50s, and SAR. 
If data is present in the document, you MUST extract it. Do not return empty fields if the information exists.

Look specifically in:
- Tables (Activity tables, IC50/KD tables, binding affinity tables)
- "Examples" sections (e.g., Example 1, Example 2, Example 3)
- "Results" or "Functional Characterization" sections

Extract:
1. Target Activity: Binding affinity (KD, Ka, Kd), functional assays (IC50, EC50), or neutralization data.
2. Functional SAR: Any mention of how specific mutations or CDR changes affect binding/activity.
3. Cell Line: Host cells used for production or assays (e.g., CHO, HEK293).
4. ADMET: Any data on Absorption, Distribution, Metabolism, Excretion, or Toxicity.
5. PK: Pharmacokinetics parameters (half-life, clearance, Vd).
6. Physicochemical: Molecular weight, pI, thermal stability (Tm), aggregation, solubility.
7. Evidence Page: The specific page number or section title where this information was found.

Return JSON format mapping mAb names to their properties.`;

      let propParts: any[] = [];
      if (typeof input === "string") {
        propParts.push({ text: `Deep search properties for [${mAbNames}] in the following text. Be exhaustive for these specific antibodies.\n\n${input}` });
      } else {
        propParts.push({
          inlineData: {
            data: input.data,
            mimeType: input.mimeType,
          },
        });
        propParts.push({ text: `Deep search properties for [${mAbNames}] in this document. Search every page and table. Be exhaustive for these specific antibodies.` });
      }

      const propResponse: GenerateContentResponse = await ai.models.generateContent({
        model,
        contents: { parts: propParts },
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
        },
      });

      const propText = propResponse.text;
      if (propText) {
        try {
          const propData = JSON.parse(propText) as { properties: any[] };
          // Merge properties back into result
          const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
          
          result.antibodies = result.antibodies.map(mAb => {
            const props = propData.properties.find(p => normalize(p.mAbName) === normalize(mAb.mAbName));
            if (props) {
              const { mAbName, ...rest } = props;
              return { ...mAb, properties: { ...mAb.properties, ...rest } };
            }
            return mAb;
          });
          
          // Update usage metadata
          if (propResponse.usageMetadata && result.usageMetadata) {
            result.usageMetadata.promptTokenCount += (propResponse.usageMetadata.promptTokenCount || 0);
            result.usageMetadata.candidatesTokenCount += (propResponse.usageMetadata.candidatesTokenCount || 0);
            result.usageMetadata.totalTokenCount += (propResponse.usageMetadata.totalTokenCount || 0);
          }
        } catch (e) {
          console.warn("Failed to parse property response for batch:", propText);
        }
      }
    }
  }

  return result;
}
