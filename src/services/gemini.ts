import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ExtractionResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export type ExtractionMode = 'sequences' | 'full';

export async function extractSequences(
  input: string | { data: string; mimeType: string },
  pageContext?: string,
  mode: ExtractionMode = 'sequences'
): Promise<ExtractionResult> {
  const model = "gemini-3.1-pro-preview";
  
  const SYSTEM_INSTRUCTION = `You are a bioinformatics expert specializing in antibody sequence and property extraction from patent documents. 
Your task is to identify and extract monoclonal antibody (mAb) information mentioned in the document or specific section.

Extraction Modes:
1. "sequences": Extract mAb name, Heavy/Light chain variable regions, and CDRs (CDR1, CDR2, CDR3).
2. "full": In addition to sequences, extract properties like target activity, cell line, ADMET, PK, physchem, and other properties. Also identify the page number(s) where this evidence was found.

Guidelines:
1. Extract the full variable region sequence for each antibody identified.
2. If the data is in a table, iterate through all rows to capture every unique antibody.
3. Identify CDRs accurately based on standard numbering schemes (like IMGT, Kabat, or Chothia).
4. For "full" mode, search for activity data (IC50, KD, etc.), cell lines used, ADMET (Absorption, Distribution, Metabolism, Excretion, Toxicity), PK (Pharmacokinetics), and physicochemical properties.
5. Provide metadata: Patent ID and Patent Title.
6. Return the data in a structured JSON format.`;

  let parts: any[] = [];
  const contextPrompt = pageContext ? ` Focus specifically on the information found on or near: ${pageContext}.` : "";
  const modePrompt = mode === 'full' 
    ? "Perform a FULL extraction including sequences AND properties (activity, PK, ADMET, etc.)." 
    : "Perform a SEQUENCE extraction (mAb name, chains, and CDRs only).";
  
  if (typeof input === "string") {
    parts.push({ text: `${modePrompt} Extract from the following text.${contextPrompt}\n\nNote: The data is likely in a table. Ensure EVERY antibody row is captured.\n\n${input}` });
  } else {
    parts.push({
      inlineData: {
        data: input.data,
        mimeType: input.mimeType,
      },
    });
    parts.push({ text: `${modePrompt} Extract from this document.${contextPrompt} Pay special attention to tables like 'TABLE 1' where multiple antibodies are listed. Capture every single one.` });
  }

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
                properties: {
                  type: Type.OBJECT,
                  properties: {
                    targetActivity: { type: Type.STRING, description: "Activity against target (e.g. IC50, KD)" },
                    cellLine: { type: Type.STRING },
                    admet: { type: Type.STRING },
                    pk: { type: Type.STRING },
                    physchem: { type: Type.STRING },
                    otherProperties: { type: Type.STRING },
                    evidencePage: { type: Type.STRING, description: "Page number or section where evidence was found" },
                  }
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

  const text = response.text;
  if (!text) throw new Error("No response from AI");
  
  try {
    const result = JSON.parse(text) as ExtractionResult;
    // Extract usage metadata if available
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
    throw new Error("Failed to parse extraction result");
  }
}
