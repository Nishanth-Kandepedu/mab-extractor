import { GoogleGenAI, Type, GenerateContentResponse, ThinkingLevel } from "@google/genai";
import { ExtractionResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const SYSTEM_INSTRUCTION = `You are a high-precision bioinformatics expert specializing in antibody sequence extraction from patent documents. 
Your primary goal is 100% Coverage (extracting every single mAb) and 100% Verbatim Accuracy.

Guidelines:
1. Comprehensive Extraction: Scan the ENTIRE document/text from beginning to end. Identify and extract EVERY unique monoclonal antibody (mAb) mentioned. 
2. Multi-Table/Multi-Page Scan: Antibodies are often listed in large tables that span multiple pages or are split across multiple tables (e.g., Table 1, Table 2, etc.). You MUST scan all tables and all pages to find every antibody.
3. Expected Count: There are typically 30-40+ antibodies in these patents (e.g., 34 antibodies). Do not stop until you have captured every single one identified in the document.
4. Verbatim Sequences: Extract amino acid sequences EXACTLY as they appear. For each mAb, you must find both the Heavy (VH) and Light (VL) chain variable regions.
5. VL Chain Focus: Pay extra attention to Light chain (VL) sequences, as they are historically more prone to errors. Verify them character-by-character.
6. Source Priority: Use "Sequence Listings" as the primary source of truth for character accuracy if available.
7. CDR Identification: Identify CDR1, CDR2, and CDR3 for each chain based on standard numbering (IMGT/Kabat).
8. Output Format: Return the data in the specified JSON format. Ensure the JSON is complete and not truncated.

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
    parts.push({ text: `Thoroughly extract ALL mAb sequences from the following text.${contextPrompt} Scan the entire text to ensure every single antibody (typically 34+) is captured without exception.\n\n${input}` });
  } else {
    parts.push({
      inlineData: {
        data: input.data,
        mimeType: input.mimeType,
      },
    });
    parts.push({ text: `Thoroughly extract ALL mAb sequences from this document.${contextPrompt} There are approximately 34 antibodies in the tables; you MUST scan all pages and tables to capture all of them with 100% verbatim accuracy.` });
  }

  const response: GenerateContentResponse = await ai.models.generateContent({
    model,
    contents: { parts },
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      maxOutputTokens: 65536,
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

  let text = response.text;
  if (!text) {
    console.error("Empty response from AI. Usage Metadata:", response.usageMetadata);
    throw new Error("No response from AI. The extraction may have timed out or exceeded token limits.");
  }
  
  // Clean the text - in JSON mode it should be pure JSON, but we handle edge cases
  text = text.trim();
  if (text.startsWith("```json")) {
    text = text.split("```json")[1].split("```")[0].trim();
  } else if (text.startsWith("```")) {
    text = text.split("```")[1].split("```")[0].trim();
  }
  
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
    console.error("Failed to parse AI response. Text length:", text.length);
    console.error("Text preview (last 100 chars):", text.slice(-100));
    console.error("Usage Metadata:", response.usageMetadata);
    throw new Error(`Failed to parse extraction result. The output was likely too large for a single pass (Length: ${text.length}). Please try extracting a smaller range of pages.`);
  }
}
