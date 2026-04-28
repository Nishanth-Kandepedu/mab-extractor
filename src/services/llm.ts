import { ExtractionResult, Antibody } from "../types";
import { getPdfPages } from "../lib/pdf";

export const SYSTEM_INSTRUCTION = `You are an expert in high-quality antibody sequence mining from patent documents. 
Your goal is 100% Verbatim Accuracy and 100% Coverage.

IMPORTANT EXTRACTION RULES:

1. Antibody Naming:
   - Main antibodies: "2419", "3125", etc.
   - Variants: "2419-0105", "2419-1204", "4540-033", etc.
   - Treat variants as SEPARATE antibodies with their own VH/VL chains.

2. VL Chain Special Handling:
   - VL chains may appear in a DIFFERENT TABLE than VH chains.
   - VL sequences are typically 110-120 amino acids long.
   - If VL appears incomplete, check the next page or table.

3. Validation & Domain Boundary:
   - VH sequences: typically 115-125 amino acids. Ends with conserved "WGXG" motif.
   - VL sequences: typically 110-120 amino acids. Ends with conserved "FGXG" motif.
   - VARIABLE DOMAIN ONLY: You MUST only extract the Variable Domain (Fv). Do NOT include the Constant Region (CH1, CL, etc.).
   - If the source (e.g., Sequence Listing) contains the full chain, you MUST truncate it to include ONLY the variable domain, terminating immediately after the J-segment (Framework 4) motifs mentioned above.

4. Table Structure & Coverage:
    - TABLE-FIRST PROTOCOL: You MUST perform an exhaustive scan of every Table (e.g., Table 1, Table 3, Table 6) before processing summarizing text. Tables are the source of truth for the complete list of clones.
    - Some antibodies may have their sequences split across multiple rows or pages.
    - For antibodies like "2419-1204", ensure you capture the COMPLETE Variable Domain sequence.
    - Check for table headers like "SEQ ID NO", "VH", "VL" to identify columns.
    - MANDATORY: Extract every single clone/antibody listed in a table. Do not stop after the first few. If a table spans multiple pages, continue extraction until the end of the table.

5. Mandatory SEQ ID & Evidence:
    - You MUST extract the "SEQ ID NO" for every sequence found.
    - Capture the exact page number and table ID (if applicable) for every sequence.
    - The "evidenceStatement" should include the SEQ ID, page, and table coordinates.

6. Target Identification: Every antibody sequence has a primary binding target (antigen) (e.g., HER2, PD-L1, CD20, IFN-gamma). 
    - CRITICAL: Distinguish between the DIRECT BINDING TARGET (antigen) and any downstream signaling molecules or transcription factors (e.g., STAT1, SMAD). 
    - You must extract the antigen that the antibody is designed to bind to. 
    - Include this target and include it as "target" in every chain object.
7. ID-Mapping & Cross-Referencing Strategy: 
    - First, identify every unique mAb ID (e.g., "mAb 1", "2419") from the tables. You MUST extract sequences for every ID found.
    - CROSS-REFERENCE: Many antibodies have multiple names (e.g., "mAb 1" is "REGN7075"). You MUST map these names together in the "mAbName" field (e.g., "mAb 1 (REGN7075)") or ensure both are mentioned in the summary.
    - ANTI-LAZINESS: Do NOT rely on candidate summaries in the text which often omit the "parental" clones listed in the tables. If a clone exists in a table, it MUST be in your output.
8. Chain-by-Chain Verification: Treat every Heavy (VH) and Light (VL) chain as a standalone high-quality mining task. After extracting a sequence, internally re-read the source text to verify every single amino acid.
9. Length-Check Validation: For every sequence extracted, verify that the character count matches the source Variable Domain exactly. Do not truncate or "summarize" variable sequences, but do exclude constant regions.
10. VL Chain Priority: Given the higher historical error rate in VL chains, dedicate extra reasoning cycles to the Light chain variable regions.
11. Source Priority: Always use "Sequence Listings" as the primary source of truth for character accuracy over table text.
12. CDR Identification: Identify CDR1, CDR2, and CDR3 based on standard numbering (IMGT/Kabat).
13. Non-Standard Amino Acids: If you encounter letters other than the standard 20 (ACDEFGHIKLMNPQRSTVWY), extract them exactly as they appear. The system will flag them later.
14. Return the data in valid JSON format.
15. CRITICAL: Ensure the JSON is valid and complete. If the output is getting too long, prioritize the most important antibodies first.

16. BISPECIFIC & MULTISPECIFIC HANDLING:
    - Many patents describe bispecific antibodies (e.g., EGFR x CD28). 
    - You MUST look for components of BOTH binding arms.
    - If the patent title mentions two targets (A x B), you are not finished until you have extracted sequences for both Target A and Target B components.
    - CROSS-TABLE SEARCH: Sequence data for different arms often reside in separate tables or pages. You MUST search the entire provided text/listing to connect them.
    - LABELING: In the "summary" or "mAbName", clearly indicate if a sequence belongs to "Arm 1", "Arm 2", "Target A", or "Target B". 
    - COMMON LIGHT CHAIN: If a bispecific uses a common light chain, Ensure that light chain is associated with both Heavy chain components in the final JSON.

17. TABLE SCANNING HIERARCHY:
    - STEP 1: Scan Table 1 & Table 3 for "Parental" antibodies (e.g., mAb12999P2, mAb14226). These MUST be extracted as separate entries.
    - STEP 2: Scan Table 6 (or equivalent) for "Bispecific/Multi-specific" assemblies (e.g., bsAb7075, REGN7075).
    - STEP 3: Ensure every ID mentioned in these tables is cross-referenced with the Sequence Listing for verbatim accuracy.
    - STEP 4: If a clone name like "mAb12999P2" appears in any table, it MUST be extracted. Do NOT skip parental clones just because they are part of a larger multispecific assembly. Every clone ID in Table 1 and Table 3 is a mandatory mining target.

18. PARENTAL VS COMPONENT CLONES:
    - When a Bispecific antibody (bsAb) is made of two parental antibodies (mAbs), you MUST extract the parental mAbs individually AND the bispecific assembly. 
    - Total coverage means if Table 1 has 10 mAbs and Table 6 has 5 bsAbs, your output should contain at least 15 antibody objects.
`;

export const GEMMA_4_EXTRA_INSTRUCTION = `
19. STRUCTURED EXPERIMENTAL MINING (CATEGORIZED):
    For each antibody clone, you MUST extract the following properties into the "experimentalData" array, categorized strictly:
    
    - "In Vitro": Target or cell line centric activity/potency/affinity. (e.g., Kd, IC50, EC50, binding by ELISA/FACS/SPR, neutralization).
    - "PK": Pharmacokinetics (e.g., half-life, clearance, Vd, Cmax, AUC). Specify species (Cyno, Mouse, Human).
    - "ADMET": Absorption, Distribution, Metabolism, Excretion, and Toxicity-related data (e.g., stability in serum, solubility, viscosity, immunogenicity).
    - "In Vivo": Efficacy in animal models (e.g., Tumor Growth Inhibition (TGI), survival rates, dose-response in xenografts).
    - "Physical": Biophysical properties (e.g., Tm (melting temperature), Tagg, aggregation %, pI, purity, hydrophobicity).
    - "Other": Any other critical pharmaceutical property mentioned.

    Association: Every entry MUST include:
    - category: One of the 6 strings above.
    - property: The name of the parameter (e.g., "IC50", "Half-life").
    - value: The exact numerical value or range.
    - unit: The unit of measurement (e.g., "nM", "days", "°C").
    - condition: The specific assay or experimental context (e.g., "in human PD-L1 ELISA", "in MC38 tumor bearing mice, 10mg/kg").
    - evidence: The page or table number where this value was found.
`;

export type LLMProvider = 'gemini' | 'openai' | 'anthropic' | 'gemma';

export interface LLMOptions {
  provider: LLMProvider;
  model?: string;
  isSarMode?: boolean;
}

/**
 * Robustly extracts and repairs JSON from a string that might be truncated or malformed.
 */
function extractJson(text: string): any {
  if (!text || typeof text !== 'string') {
    throw new Error("Empty or invalid response received from AI");
  }

  const cleanText = text.trim();

  // 1. Try direct parsing
  try {
    return JSON.parse(cleanText);
  } catch (e) {
    // Continue to more aggressive methods
  }

  // 2. Try to find JSON block in markdown
  const markdownMatch = cleanText.match(/```json\s*([\s\S]*?)\s*```/) || cleanText.match(/```\s*([\s\S]*?)\s*```/);
  if (markdownMatch && markdownMatch[1]) {
    const inner = markdownMatch[1].trim();
    try {
      return JSON.parse(inner);
    } catch (e) {
      // Try to repair the inner content
      try {
        return repairAndParseJson(inner);
      } catch (e2) {}
    }
  }

  // 3. Find the first '{' and try to parse/repair from there
  const firstBrace = cleanText.indexOf('{');
  if (firstBrace !== -1) {
    const lastBrace = cleanText.lastIndexOf('}');
    let candidate = "";
    
    if (lastBrace !== -1 && lastBrace > firstBrace) {
      candidate = cleanText.substring(firstBrace, lastBrace + 1);
    } else {
      // No closing brace found, take everything from the first brace
      candidate = cleanText.substring(firstBrace);
    }

    try {
      return JSON.parse(candidate);
    } catch (e) {
      // Final attempt: Repair and parse
      try {
        return repairAndParseJson(candidate);
      } catch (e2) {
        console.error("JSON Repair failed. Original text snippet:", cleanText.substring(0, 200));
        throw new Error("Could not parse or repair JSON response. The response may be severely truncated or malformed.");
      }
    }
  }

  throw new Error("No JSON structure found in the AI response.");
}

/**
 * Attempts to repair truncated JSON by closing open brackets and braces.
 */
function repairAndParseJson(jsonStr: string): any {
  let repaired = jsonStr.trim();
  
  // Remove trailing commas which are common in truncated JSON
  repaired = repaired.replace(/,\s*$/, "");
  repaired = repaired.replace(/,\s*([}\]])/g, "$1");

  const stack: string[] = [];
  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];
    if (char === '{' || char === '[') {
      stack.push(char);
    } else if (char === '}' || char === ']') {
      const last = stack.pop();
      if ((char === '}' && last !== '{') || (char === ']' && last !== '[')) {
        // Mismatched - this is a simple repairer, so we might just fail here
        // but let's try to keep going
      }
    }
  }

  // Close remaining open structures in reverse order
  while (stack.length > 0) {
    const last = stack.pop();
    if (last === '{') repaired += '}';
    else if (last === '[') repaired += ']';
  }

  try {
    return JSON.parse(repaired);
  } catch (e) {
    // If it still fails, try one more aggressive trim to the last valid closing character
    const lastClosing = Math.max(repaired.lastIndexOf('}'), repaired.lastIndexOf(']'));
    if (lastClosing !== -1) {
      try {
        return JSON.parse(repaired.substring(0, lastClosing + 1));
      } catch (e2) {
        throw e; // Give up
      }
    }
    throw e;
  }
}

export async function extractWithLLM(
  input: string | { data: string; mimeType: string },
  options: LLMOptions,
  pageContext?: string,
  sequenceListing?: { data: string; mimeType: string },
  prioritySeqIds?: string
): Promise<ExtractionResult> {
  if (!input || (typeof input === 'string' && input.trim().length === 0)) {
    throw new Error("Input text is required for extraction.");
  }
  if (typeof input !== 'string' && (!input.data || input.data.trim().length === 0)) {
    throw new Error("Input data is required for extraction.");
  }
  
  try {
    const { provider, model } = options;

  const contextPrompt = pageContext ? ` Focus specifically on the information found on or near: ${pageContext}.` : "";
  const priorityPrompt = prioritySeqIds ? `\n\nCRITICAL TARGETS: The user has flagged the following identifiers (SEQ ID NOs or Clone Names) as missing or priority: ${prioritySeqIds}. You MUST find and extract these specific sequences verbatim from the document or sequence listing, ensuring every mentioned ID/Clone is represented in the output.` : "";
  
  let formattedInput: any;

  if (typeof input === "string") {
    formattedInput = `Extract ALL antibody sequences including Parental mAbs (Table 1/3) and Bispecifics (Table 6).${contextPrompt}${priorityPrompt}\n\nANTY-LAZINESS RULE: You MUST identify every mAb ID mentioned in early tables. Do not omit monoclonal parental clones.\n\n${input}`;
  } else {
    // For Gemini/Gemma infrastructure, we support multimodal inputs
    if (provider !== 'gemini' && provider !== 'gemma') {
      throw new Error(`File upload is currently only supported for Gemini/Gemma. Please switch provider or paste the text directly.`);
    }
    
    const parts: any[] = [];
    
    // Handle main input (PDF or Text)
    if (input.mimeType === 'application/pdf') {
      let finalData = input.data;
      
      // Physically crop PDF if the context contains numbers (likely a page selection)
      if (pageContext && /[\d]+/.test(pageContext)) {
        finalData = await getPdfPages(input.data, pageContext);
      }

      parts.push({
        inlineData: {
          data: finalData,
          mimeType: input.mimeType,
        },
      });
    } else {
      // It's a text file readout
      parts.push({ text: `PRIMARY DOCUMENT CONTENT:\n${input.data}` });
    }

    if (sequenceListing) {
      if (sequenceListing.mimeType === 'application/pdf') {
        parts.push({
          inlineData: {
            data: sequenceListing.data,
            mimeType: sequenceListing.mimeType,
          },
        });
      } else {
        parts.push({ text: `SEQUENCE LISTING CONTENT:\n${sequenceListing.data}` });
      }
      parts.push({ text: `Extract all sequences from the patent and sequence listing.${contextPrompt}${priorityPrompt} Identify Parental clones in Tables 1/3 and Bispecifics in Table 6. Extract all separately. Verbatim accuracy is mandatory.` });
    } else {
      parts.push({ text: `Extract all antibody sequences.${contextPrompt}${priorityPrompt} Ensure every mAb ID in Tables 1/3 and every bsAb in Table 6 is captured separately.` });
    }

    formattedInput = parts;
  }

    const isGemma4 = model === 'gemma-4';
    const useSarExtra = isGemma4 && options.isSarMode;
    const activeInstruction = useSarExtra ? (SYSTEM_INSTRUCTION + GEMMA_4_EXTRA_INSTRUCTION) : SYSTEM_INSTRUCTION;

    const responseSchema: any = {
      type: "OBJECT",
      properties: {
        patentId: { type: "STRING" },
        patentTitle: { type: "STRING" },
        antibodies: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              mAbName: { type: "STRING" },
              chains: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    type: { type: "STRING", enum: ["Heavy", "Light"] },
                    fullSequence: { type: "STRING" },
                    seqId: { type: "STRING" },
                    pageNumber: { type: "INTEGER" },
                    tableId: { type: "STRING" },
                    target: { type: "STRING" }, 
                    cdrs: {
                      type: "ARRAY",
                      items: {
                        type: "OBJECT",
                        properties: {
                          type: { type: "STRING", enum: ["CDR1", "CDR2", "CDR3"] },
                          sequence: { type: "STRING" },
                          start: { type: "INTEGER" },
                          end: { type: "INTEGER" },
                        },
                        required: ["type", "sequence", "start", "end"],
                      },
                    },
                  },
                  required: ["type", "fullSequence", "cdrs", "seqId", "pageNumber", "target"],
                },
              },
              confidence: { type: "NUMBER" },
              summary: { type: "STRING" },
              evidenceLocation: { type: "STRING" },
              evidenceStatement: { type: "STRING" },
              needsReview: { type: "BOOLEAN" },
              reviewReason: { type: "STRING" },
              experimentalData: useSarExtra ? {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    category: { type: "STRING", enum: ["In Vitro", "PK", "ADMET", "In Vivo", "Physical", "Other"] },
                    property: { type: "STRING" },
                    value: { type: "STRING" },
                    unit: { type: "STRING" },
                    condition: { type: "STRING" },
                    evidence: { type: "STRING" }
                  },
                  required: ["category", "property", "value", "unit", "condition", "evidence"]
                }
              } : undefined
            },
            required: ["mAbName", "chains", "confidence", "summary"],
          },
        },
      },
      required: ["patentId", "patentTitle", "antibodies"],
    };

    const payload = JSON.stringify({
      provider,
      model,
      input: formattedInput,
      systemInstruction: activeInstruction,
      thinkingLevel: (model?.includes('3.1') || isGemma4) ? "HIGH" : undefined,
      responseSchema: responseSchema,
    });

    console.log(`[Extraction] Initiating fetch. Payload size: ${payload.length} bytes`);
    if (payload.length > 1000000) {
      console.warn("[Extraction] Payload size exceeds 1MB. This may be blocked by some proxies on custom domains.");
    }

    let startResponse: Response | null = null;
    let postAttempts = 0;
    const maxPostAttempts = 3;

    while (postAttempts < maxPostAttempts) {
      try {
        startResponse = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
        break; // Success
      } catch (postError: any) {
        postAttempts++;
        const isNetworkError = postError.message?.toLowerCase().includes('fetch') || 
                               postError.message?.toLowerCase().includes('network');
        
        if (isNetworkError && postAttempts < maxPostAttempts) {
          console.warn(`[Extraction] POST network error (attempt ${postAttempts}): ${postError.message}. Retrying in 2s...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          throw postError;
        }
      }
    }

    if (!startResponse || !startResponse.ok) {
      const errorData = await startResponse?.json().catch(() => ({ error: `Server error: ${startResponse?.status}` }));
      throw new Error(errorData.error || `Server error: ${startResponse?.status}`);
    }

    const { jobId } = await startResponse.json();
    console.log(`[Extraction] Job started: ${jobId}`);

    // 2. Poll for results
    let result: ExtractionResult | null = null;
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes (5s intervals)

    const baseUrl = window.location.origin;

    while (attempts < maxAttempts) {
      const timestamp = Date.now();
      console.log(`[Extraction] Polling attempt ${attempts + 1}/${maxAttempts} for job ${jobId}...`);
      try {
        const statusResponse = await fetch(`${baseUrl}/api/extract/status/${jobId}?t=${timestamp}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        });
        if (!statusResponse.ok) {
          console.error(`[Extraction] Status check failed: ${statusResponse.status} ${statusResponse.statusText}`);
          throw new Error(`Failed to check job status: ${statusResponse.status}`);
        }

        const job = await statusResponse.json();
        console.log(`[Extraction] Job ${jobId} status: ${job.status}`);

        if (job.status === 'completed') {
          result = job.result;
          break;
        } else if (job.status === 'failed') {
          throw new Error(job.error || 'Extraction job failed');
        }
      } catch (pollError: any) {
        // If it's a network error, retry a few times before giving up
        const errorMsg = pollError.message?.toLowerCase() || "";
        const isNetworkError = errorMsg.includes('fetch') || 
                               errorMsg.includes('network') ||
                               errorMsg.includes('aborted') ||
                               errorMsg.includes('failed to fetch') ||
                               pollError.name === 'TypeError';
        
        if (isNetworkError && attempts < maxAttempts - 1) {
          console.warn(`[Extraction] Polling network error (attempt ${attempts + 1}): ${pollError.message}. Retrying in 5s...`);
          // Check if we are still online
          if (!navigator.onLine) {
            console.error("[Extraction] Browser is offline. Waiting for connection...");
          }
        } else {
          console.error("[Extraction] Non-recoverable polling error:", pollError);
          throw pollError;
        }
      }

      // Wait 5 seconds before next poll with jitter
      const jitter = Math.floor(Math.random() * 1000);
      await new Promise(resolve => setTimeout(resolve, 5000 + jitter));
      attempts++;
    }

    if (!result) {
      throw new Error("Extraction timed out after 10 minutes.");
    }
  
  // Post-processing and Validation
  result.patentId = result.patentId || "Unknown";
  result.patentTitle = result.patentTitle || "Untitled Patent";
  result.antibodies = result.antibodies || [];
  
  const STANDARD_AMINO_ACIDS = new Set("ACDEFGHIKLMNPQRSTVWY");

  result.antibodies = result.antibodies.map(mAb => {
    // Normalize confidence to 0-100 scale
    if (mAb.confidence <= 1 && mAb.confidence > 0) {
      mAb.confidence = Math.round(mAb.confidence * 100);
    } else if (mAb.confidence < 0) {
      mAb.confidence = 0;
    } else if (mAb.confidence > 100) {
      mAb.confidence = 100;
    }

    let needsReview = mAb.needsReview || false;
    let reviewReason = mAb.reviewReason || "";

    mAb.chains = mAb.chains.map(chain => {
      let seq = chain.fullSequence.replace(/\s/g, ''); // Remove any whitespace
      
      // Re-calculate CDR indices to ensure they sync with the full sequence
      // This is more robust than relying on LLM-generated indices which are often off-by-one or hallucinated.
      let lastCdrEnd = 0;
      chain.cdrs = chain.cdrs.map(cdr => {
        const cleanCdrSeq = cdr.sequence.replace(/\s/g, '');
        // Search for the CDR sequence within the full sequence, starting from the end of the last CDR
        let foundIndex = seq.indexOf(cleanCdrSeq, lastCdrEnd);
        
        // If not found after last CDR, try searching from the beginning (in case of out-of-order extraction)
        if (foundIndex === -1) {
          foundIndex = seq.indexOf(cleanCdrSeq);
        }

        if (foundIndex !== -1) {
          const newStart = foundIndex;
          const newEnd = foundIndex + cleanCdrSeq.length;
          lastCdrEnd = newEnd;
          return { ...cdr, sequence: cleanCdrSeq, start: newStart, end: newEnd };
        }
        
        // Fallback: if sequence not found verbatim, keep original but warn
        return { ...cdr, sequence: cleanCdrSeq };
      });

      // Non-standard amino acid detection
      const nonStandard: string[] = [];
      for (const char of seq) {
        if (!STANDARD_AMINO_ACIDS.has(char.toUpperCase())) {
          nonStandard.push(char);
        }
      }

      if (nonStandard.length > 0) {
        chain.hasNonStandardAminoAcids = true;
        chain.nonStandardAminoAcids = Array.from(new Set(nonStandard));
        needsReview = true;
        reviewReason += ` [Non-standard amino acids detected: ${chain.nonStandardAminoAcids.join(', ')}]`;
      }

      // Systematic Fixes - Flag for review instead of forcing changes
      if (chain.type === 'Light') {
        // Position 12 (0-indexed: 11) L -> V potential error
        if (seq.length > 11 && seq[11] === 'L') {
          needsReview = true;
          reviewReason += " [Potential L->V error at pos 12]";
        }
        
        // VL Length Validation
        if (seq.length < 100 || seq.length > 130) {
          needsReview = true;
          reviewReason += ` [VL length anomaly: ${seq.length}]`;
          if (seq.length > 150) {
            reviewReason += " [Likely constant region included]";
          }
        }
      }

      if (chain.type === 'Heavy') {
        // Position 75 (0-indexed: 74) T -> I potential error
        if (seq.length > 74 && seq[74] === 'I') {
          needsReview = true;
          reviewReason += " [Potential T->I error at pos 75]";
        }

        // VH Length Validation
        if (seq.length < 105 || seq.length > 140) {
          needsReview = true;
          reviewReason += ` [VH length anomaly: ${seq.length}]`;
          if (seq.length > 160) {
            reviewReason += " [Likely constant region included]";
          }
        }
      }

      return { ...chain, fullSequence: seq };
    });

    // Problematic Variant Check
    if (mAb.mAbName.startsWith("2419-12") || mAb.mAbName === "4439") {
      needsReview = true;
      reviewReason += ` [Known problematic VH variant: ${mAb.mAbName}. VH chain often split or misread in tables.]`;
    }

    if (mAb.mAbName === "2218") {
      needsReview = true;
      reviewReason += " [Known problematic VL variant: 2218. VL chain often incomplete or missing in tables.]";
    }

    // Confidence-based flagging
    if (mAb.confidence < 70) {
      needsReview = true;
      reviewReason += ` [Low confidence: ${mAb.confidence}]`;
    }

    return { ...mAb, needsReview, reviewReason: reviewReason.trim() };
  });

  result.modelUsed = model || 'gemini-3.1-pro-preview';
  return result;
  } catch (e: any) {
    console.error("[Extraction] Fetch error details:", e);
    const msg = e.message?.toLowerCase() || "";
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('aborted')) {
      throw new Error("Network Error: The extraction request was blocked or timed out. This is common on custom domains (like .bio) due to proxy limits. Try using a smaller text selection or use the default Railway URL (abminer.up.railway.app) if this persists.");
    }
    throw e;
  }
}
