import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ExtractionResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const SYSTEM_INSTRUCTION = `You are a bioinformatics expert specializing in antibody sequence extraction from patent documents. 
Your task is to identify and extract ALL monoclonal antibody (mAb) sequences mentioned in the document or specific section.
For each mAb, extract the Heavy and Light chain variable regions.
For each chain, you must also identify the Complementarity-Determining Regions (CDRs): CDR1, CDR2, and CDR3.

Guidelines:
1. Systematic Extraction: Before generating the JSON, internally identify the total number of antibodies listed in the source. Ensure the final "antibodies" array length matches this count exactly.
2. If the data is in a table, iterate through every single row. Do not skip rows even if they appear repetitive.
3. Identify CDRs accurately based on standard numbering schemes (like IMGT, Kabat, or Chothia).
4. Provide metadata: Patent ID and Patent Title.
5. OCR Error Mitigation: Patent documents often contain OCR noise. Be extremely vigilant about character-level accuracy, especially for similar-looking amino acids:
   - Actively check for L vs V confusions (especially at position 12 in VL chains).
   - Actively check for T vs I, S vs A, and S vs R confusions.
   - If a sequence is found in both a table and a sequence listing, use the sequence listing as the primary source of truth for character accuracy.
6. Return the data in a structured JSON format.

Output Schema:
{
  "patentId": "string",
  "patentTitle": "string",
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
      "summary": "string"
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
    parts.push({ text: `Extract ALL mAb sequences from the following text.${contextPrompt}\n\nNote: The data is likely in a table. Ensure EVERY antibody row is captured.\n\n${input}` });
  } else {
    parts.push({
      inlineData: {
        data: input.data,
        mimeType: input.mimeType,
      },
    });
    parts.push({ text: `Extract ALL mAb sequences from this document.${contextPrompt} Pay special attention to tables like 'TABLE 1' where multiple antibodies are listed. Capture every single one.` });
  }

  const response: GenerateContentResponse = await ai.models.generateContent({
    model,
    contents: { parts },
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0,
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
