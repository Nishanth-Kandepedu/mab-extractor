import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ExtractionResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export type ExtractionMode = 'sequences' | 'full';

export async function extractSequences(
  input: string | { data: string; mimeType: string },
  pageContext?: string,
  mode: ExtractionMode = 'sequences',
  onProgress?: (step: string) => void
): Promise<ExtractionResult> {
  const model = "gemini-3-flash-preview";
  
  // Step 1: Extract Sequences (Fast Pass)
  if (onProgress) onProgress('Identifying antibodies and extracting sequences...');
  
  const sequenceInstruction = `You are a world-class bioinformatics expert specializing in patent analysis. 
Identify and extract monoclonal antibody (mAb) names, Heavy/Light chain variable regions, and CDRs (CDR1, CDR2, CDR3) from the provided document.

Guidelines:
1. Extract the full variable region sequence for each antibody.
2. If the data is in a table, iterate through all rows.
3. Identify CDRs accurately (IMGT, Kabat, or Chothia).
4. Provide Patent ID and Patent Title.
5. Clean sequences: Remove any non-amino acid characters (spaces, numbers, etc.).
6. Return JSON format.`;

  let parts: any[] = [];
  const contextPrompt = pageContext ? ` Focus specifically on the information found on or near: ${pageContext}.` : "";
  
  if (typeof input === "string") {
    parts.push({ text: `Extract ALL mAb sequences from the following text.${contextPrompt}\n\n${input}` });
  } else {
    parts.push({
      inlineData: {
        data: input.data,
        mimeType: input.mimeType,
      },
    });
    parts.push({ text: `Extract ALL mAb sequences from this document.${contextPrompt}` });
  }

  const seqResponse: GenerateContentResponse = await ai.models.generateContent({
    model,
    contents: { parts },
    config: {
      systemInstruction: sequenceInstruction,
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

  const seqText = seqResponse.text;
  if (!seqText) throw new Error("No response from AI during sequence extraction");
  
  let result: ExtractionResult;
  try {
    result = JSON.parse(seqText) as ExtractionResult;
    if (seqResponse.usageMetadata) {
      result.usageMetadata = {
        promptTokenCount: seqResponse.usageMetadata.promptTokenCount || 0,
        candidatesTokenCount: seqResponse.usageMetadata.candidatesTokenCount || 0,
        totalTokenCount: seqResponse.usageMetadata.totalTokenCount || 0,
      };
    }
  } catch (e) {
    console.error("Failed to parse sequence response:", seqText);
    throw new Error("Failed to parse sequence extraction result");
  }

  // Step 2: Enrich Properties if mode is 'full' (Deep Pass)
  if (mode === 'full' && result.antibodies.length > 0) {
    if (onProgress) onProgress(`Performing deep search for SAR and functional data for ${result.antibodies.length} antibodies...`);
    
    const mAbNames = result.antibodies.map(a => a.mAbName).join(', ');
    const propertyInstruction = `You are a world-class bioinformatics expert. 
For the monoclonal antibodies [${mAbNames}], perform a DEEP SEARCH for functional data and Structure-Activity Relationship (SAR) details in the provided document.

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
      propParts.push({ text: `Deep search properties for [${mAbNames}] in the following text.${contextPrompt}\n\n${input}` });
    } else {
      propParts.push({
        inlineData: {
          data: input.data,
          mimeType: input.mimeType,
        },
      });
      propParts.push({ text: `Deep search properties for [${mAbNames}] in this document.${contextPrompt}` });
    }

    const propResponse: GenerateContentResponse = await ai.models.generateContent({
      model,
      contents: { parts: propParts },
      config: {
        systemInstruction: propertyInstruction,
        responseMimeType: "application/json",
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
        result.antibodies = result.antibodies.map(mAb => {
          const props = propData.properties.find(p => p.mAbName === mAb.mAbName);
          if (props) {
            const { mAbName, ...rest } = props;
            return { ...mAb, properties: rest };
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
        console.warn("Failed to parse property response, returning sequences only:", propText);
      }
    }
  }

  return result;
}
