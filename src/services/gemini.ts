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
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
      maxOutputTokens: 65536,
      responseMimeType: "application/json",
    },
  });

  let text = response.text;
  if (!text) {
    console.error("Empty response from AI. Usage Metadata:", response.usageMetadata);
    throw new Error("No response from AI. The extraction may have timed out or exceeded token limits.");
  }
  
  // Strip markdown if present
  if (text.includes("```json")) {
    text = text.split("```json")[1].split("```")[0].trim();
  } else if (text.includes("```")) {
    text = text.split("```")[1].split("```")[0].trim();
  }
  
  try {
    // Attempt to repair truncated JSON if it looks incomplete
    let processedText = text.trim();
    
    // Check if it ends abruptly (not with } or ])
    if (!processedText.endsWith('}') && !processedText.endsWith(']')) {
      console.warn("Response appears truncated, attempting to repair JSON...");
      
      // If it ends in the middle of a string, close the string first
      const lastQuoteIndex = processedText.lastIndexOf('"');
      const lastBraceIndex = processedText.lastIndexOf('{');
      const lastBracketIndex = processedText.lastIndexOf('[');
      
      // Heuristic: if the last quote is after the last brace/bracket, we might be in a string
      if (lastQuoteIndex > lastBraceIndex && lastQuoteIndex > lastBracketIndex) {
        // Count quotes to see if we have an odd number
        const quoteCount = (processedText.match(/"/g) || []).length;
        if (quoteCount % 2 !== 0) {
          processedText += '"';
        }
      }

      // Simple repair: add missing closing brackets
      let openBraces = (processedText.match(/\{/g) || []).length;
      let closeBraces = (processedText.match(/\}/g) || []).length;
      let openBrackets = (processedText.match(/\[/g) || []).length;
      let closeBrackets = (processedText.match(/\]/g) || []).length;
      
      while (openBrackets > closeBrackets) {
        processedText += ']';
        closeBrackets++;
      }
      while (openBraces > closeBraces) {
        processedText += '}';
        closeBraces++;
      }
    }

    const result = JSON.parse(processedText) as ExtractionResult;
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
    throw new Error(`Failed to parse extraction result. The output may have been truncated or contains invalid characters (Length: ${text.length}).`);
  }
}
