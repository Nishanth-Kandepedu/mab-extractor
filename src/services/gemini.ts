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
  
  if (onProgress) onProgress(mode === 'full' ? 'Extracting sequences and properties...' : 'Extracting sequences...');
  
  const systemInstruction = `You are a world-class bioinformatics expert specializing in patent analysis and monoclonal antibody (mAb) characterization. 
Your task is to identify and extract detailed information about monoclonal antibodies mentioned in the provided document.

${mode === 'full' ? `CRITICAL: You MUST perform a FULL EXTRACTION. This means you must find NOT ONLY the sequences but also all available functional and biophysical properties (Activity, Cell Line, ADMET, PK, Physchem).` : 'You are performing a SEQUENCE-ONLY extraction.'}

Extraction Requirements:
1. mAb Identification: Identify every unique mAb mentioned by name or identifier.
2. Sequence Extraction: For each mAb, extract the full variable region amino acid sequence for both Heavy and Light chains.
3. CDR Identification: Precisely identify CDR1, CDR2, and CDR3 for each chain.
${mode === 'full' ? `4. Property Enrichment (MANDATORY for Full Mode):
   - Target Activity: Binding data (KD, Ka, Kd), functional assays (IC50, EC50), or neutralization data.
   - Cell Line: Host cells used for production or assays (e.g., CHO, HEK293).
   - ADMET: Any data on Absorption, Distribution, Metabolism, Excretion, or Toxicity.
   - PK: Pharmacokinetics parameters (half-life, clearance, Vd).
   - Physicochemical: Molecular weight, pI, thermal stability (Tm), aggregation, solubility.
   - Other Properties: Any other relevant data.
   - Evidence Page: The specific page number or section title where this information was found.` : ''}

Guidelines:
- Search thoroughly through text, tables, and figure descriptions.
- Clean sequences: Remove any non-amino acid characters (spaces, numbers, etc.).
- Confidence Score: Provide a score from 0.0 to 1.0 reflecting your certainty.
- Summary: Provide a 1-2 sentence technical summary of the antibody's role or significance.
- Format: Return valid JSON matching the provided schema exactly.`;

  let parts: any[] = [];
  const contextPrompt = pageContext ? ` Focus specifically on the information found on or near: ${pageContext}.` : "";
  
  if (typeof input === "string") {
    parts.push({ text: `Extract mAb data from the following text.${contextPrompt}\n\n${input}` });
  } else {
    parts.push({
      inlineData: {
        data: input.data,
        mimeType: input.mimeType,
      },
    });
    parts.push({ text: `Extract mAb data from this document.${contextPrompt}` });
  }

  const antibodyProperties: any = {
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
  };

  if (mode === 'full') {
    antibodyProperties.properties = {
      type: Type.OBJECT,
      properties: {
        targetActivity: { type: Type.STRING },
        cellLine: { type: Type.STRING },
        admet: { type: Type.STRING },
        pk: { type: Type.STRING },
        physchem: { type: Type.STRING },
        otherProperties: { type: Type.STRING },
        evidencePage: { type: Type.STRING },
      }
    };
  }

  const response: GenerateContentResponse = await ai.models.generateContent({
    model,
    contents: { parts },
    config: {
      systemInstruction,
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
              properties: antibodyProperties,
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
  
  try {
    const result = JSON.parse(text) as ExtractionResult;
    if (response.usageMetadata) {
      result.usageMetadata = {
        promptTokenCount: response.usageMetadata.promptTokenCount || 0,
        candidatesTokenCount: response.usageMetadata.candidatesTokenCount || 0,
        totalTokenCount: response.usageMetadata.totalTokenCount || 0,
      };
    }
    return result;
  } catch (e) {
    console.error("Failed to parse AI response:", text);
    throw new Error("Failed to parse extraction result. The document might be too complex or the output format was invalid.");
  }
}
