import { ExtractionResult, Antibody } from "../types";
import { getPdfPages, getPdfPageCount } from "../lib/pdf";

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
   - VH sequences: typically 115-125 amino acids. Ends with conserved "WGXG" motif (Framework 4).
   - VL sequences: typically 110-120 amino acids. Ends with conserved "FGXG" motif (Framework 4).
   - VARIABLE DOMAIN ONLY (Fv): You MUST only extract the Variable Domain. Do NOT include the Constant Region (CH1, CH2, CH3, CL, or Hinges).
   - DISCARD CONSERVED REGIONS: Sequences starting with "ASTKGP..." (CH1) or "RTVAAP..." (CL) are CONSTANT REGIONS and must be excluded. 
   - TRUNCATION RULE: Truncate the sequence immediately after the J-segment motifs:
     * VH: Ends after ...VTVSS or ...WGXG.
     * VL (Kappa/Lambda): Ends after ...VEIK, ...VFGXG, or ...FGGGTK.
   - If the source contains the full chain, you MUST truncate it to the variable domain (max ~130 AA). Anything beyond the J-motif (VTVSS/VEIK) is a constant region and MUST be deleted from the extracted sequence. Extract ONLY the Fv.
   - LENGTH LIMIT: High-quality variable domains are NEVER longer than 135 AA. If you find a sequence that looks longer, you are likely failing to identify the J-motif/Constant Region boundary. Re-examine and truncate.

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
    - CRITICAL: Distinguish between the DIRECT BINDING TARGET (antigen) and any downstream signaling molecules, receptors, or ligands.
    - RECEPTOR VS LIGAND: Be extremely careful not to swap the receptor and ligand. If the antibody binds to "CD3", its target is "CD3" (or "CD3E/P07766"), NOT the other arm's target (like MICA) or the cell it's on.
    - Example: In a bispecific "Anti-CD3 x Anti-MICA", the CD3-binding arm has target "CD3", and the MICA-binding arm has target "MICA". DO NOT assign "MICA" to both.
    - Example: If an antibody blocks "IFN-gamma signaling" and the patent measures "STAT1 phosphorylation", the target is "IFN-gamma", NOT "STAT1".
    - You must extract the antigen that the antibody is designed to bind to. 
    - Include this target in every chain object.
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
14. Amino Acid Format:
    - Use ONLY single-letter amino acid codes (e.g., A, C, D, E...).
    - DO NOT USE three-letter codes (e.g., Ala, Cys, Asp, Glu, GLY). If the document uses three-letter codes, you MUST convert them to single-letter codes in your output.
    - If a sequence contains spaces or other punctuation, CLEAN IT.
    - VERBATIM ACCURACY: You must never summarize or approximate a sequence. Every character must match the source exactly.
15. Return the data in valid JSON format.
16. CRITICAL: Ensure the JSON is valid and complete.

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

19. EPITOPE, TARGET SPECIES & ANTIBODY ORIGIN:
    - For every antibody, attempt to identify the specific epitope residues it binds to on the target (e.g., "K43, Q48, and K86 of human IFN-gamma").
    - Identify the TARGET SPECIES (the biological source of the antigen/target protein).
    - MANDATORY STANDARDIZATION for Target Species:
      * "Human" -> "Homo sapiens"
      * "Cynomolgus" or "Cyno" -> "Macaca fascicularis"
      * "Rhesus" -> "Macaca mulatta"
      * "Mouse" -> "Mus musculus"
      * "Rat" -> "Rattus norvegicus"
      * "Rabbit" -> "Oryctolagus cuniculus"
    - Identify the ANTIBODY ORIGIN (the species or method used to generate the antibody). Examples: "Humanized", "Chimeric", "Fully Human", "Mouse", "Phage Display", "Transgenic Mouse".
    - If any are not explicitly found, leave as an empty string.
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
  isDeepScanMode?: boolean;
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

    if (options.isDeepScanMode && typeof input !== 'string' && input.mimeType === 'application/pdf') {
      return await performDeepScanExtraction(input, options, sequenceListing, prioritySeqIds);
    }

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
              epitope: { type: "STRING" },
              targetSpecies: { type: "STRING" },
              antibodyOrigin: { type: "STRING" },
              needsReview: { type: "BOOLEAN" },              reviewReason: { type: "STRING" },
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

    const { patentId, patentTitle, antibodies, usageMetadata } = await executeLLMJob(payload);
  
  // Post-processing and Validation
  const result: ExtractionResult = {
    patentId: patentId || "Unknown",
    patentTitle: patentTitle || "Untitled Patent",
    antibodies: antibodies || [],
    usageMetadata
  };
  
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
      // Pre-clean sequence: remove spaces, dots, dashes, numbers, and newlines
      let seq = chain.fullSequence.replace(/[\s\.\-\d\n\r]/g, ''); 
      
      // Handle three-letter amino acid codes (e.g. "GluValGln" or "GLU VAL GLN" -> "EVQ")
      // Check if it looks like a 3-letter sequence (starts with many triplets)
      if (seq.length > 20 && (seq.match(/([A-Z][a-z][a-z]){3,}/) || seq.match(/([A-Z]{3}){3,}/))) {
          seq = convertThreeLetterToOneLetter(seq);
      }

      // OCR Correction: O -> Q (Pyrrolysine is essentially never in antibodies, Q is often misread)
      const { corrected, positions } = (function(s: string) {
        const ps: number[] = [];
        const chars = s.split('');
        for (let i = 0; i < chars.length; i++) {
          if (chars[i].toUpperCase() === 'O') {
            chars[i] = chars[i] === 'o' ? 'q' : 'Q';
            ps.push(i + 1);
          }
        }
        return { corrected: chars.join(''), positions: ps };
      })(seq);

      if (positions.length > 0) {
        seq = corrected;
        needsReview = true;
        reviewReason += ` [Auto-corrected O to Q at positions: ${positions.join(', ')}]`;
      }

      // Constant region detection (CH1 / CL common starts)
      const isCH1 = seq.startsWith("ASTKGP") || seq.includes("ASTKGPSVFPLAP");
      const isCL = seq.startsWith("RTVAAP") || seq.includes("RTVAAPSVFIFPPS");
      
      if (isCH1 || isCL) {
        needsReview = true;
        reviewReason += ` [Potential Constant Region Detected: ${isCH1 ? 'CH1' : 'CL'}]`;
      }

      // Hard Truncation for Variable Domains 
      // J-Region motifs often indicate the end of the variable domain.
      // VH usually ends with VTVSS. VL usually ends with VEIK or similar.
      const jMotifs = [
        /VTVSS[A-Z]*/,           // VH standard
        /VTVSA[A-Z]*/,           // VH variant
        /VEIK[A-Z]*/,            // VL Kappa standard
        /LEIK[A-Z]*/,            // VL Kappa variant
        /VFG[A-Z]GTK[A-Z]*/,     // VL motif
        /FGGGTK[A-Z]*/          // VL variant
      ];

      // If sequence is suspiciously long or constant region is detected, find J-motif and truncate
      if (seq.length > 135 || isCH1 || isCL) {
        let bestIndex = -1;
        let matchedMotif = "";
        
        // Find the earliest occurrence of any J-motif that is at a reasonable position (>90 AA)
        for (const motif of jMotifs) {
          const match = seq.match(motif);
          if (match && match.index !== undefined) {
            // We look for VTVSS/VEIK which should be between 100-130 usually
            if (match.index > 90 && (bestIndex === -1 || match.index < bestIndex)) {
              // Extract the base motif length (e.g., VTVSS is 5)
              // match[0] might include trailing stuff because of the regex, 
              // but we only want to truncate AFTER the conserved part.
              // VTVSS is index 0-4, so we truncate at index 5.
              const baseMotifLength = motif.source.split('[')[0].length;
              bestIndex = match.index + baseMotifLength;
              matchedMotif = match[0].substring(0, baseMotifLength);
            }
          }
        }

        if (bestIndex !== -1) {
          const originalLength = seq.length;
          seq = seq.substring(0, bestIndex);
          if (originalLength > bestIndex + 5) {
            needsReview = true;
            reviewReason += ` [Auto-truncated at ${matchedMotif}]`;
          }
        } else if (seq.length > 140) {
          // If no motif found but still long, and it contains common constant region starts, truncate there
          const cStarts = ["ASTKGP", "RTVAAP", "RTVAAPSVF"];
          for (const start of cStarts) {
            const cIndex = seq.indexOf(start);
            if (cIndex > 90) {
              seq = seq.substring(0, cIndex);
              needsReview = true;
              reviewReason += ` [Truncated at found Constant Region start: ${start}]`;
              break;
            }
          }
        }
      }
      
      // Re-calculate CDR indices to ensure they sync with the full sequence
      // This is more robust than relying on LLM-generated indices which are often off-by-one or hallucinated.
      let lastCdrEnd = 0;
      chain.cdrs = chain.cdrs.map(cdr => {
        let cleanCdrSeq = cdr.sequence.replace(/[\s\.\-\d\n\r]/g, ''); 
        if (!cleanCdrSeq) return cdr;

        // Handle three-letter amino acid codes in CDRs
        if (cleanCdrSeq.length >= 9 && (cleanCdrSeq.match(/([A-Z][a-z][a-z]){2,}/) || cleanCdrSeq.match(/([A-Z]{3}){2,}/))) {
            cleanCdrSeq = convertThreeLetterToOneLetter(cleanCdrSeq);
        }

        // OCR Correction: O -> Q in CDRs
        if (cleanCdrSeq.toUpperCase().includes('O')) {
          cleanCdrSeq = cleanCdrSeq.split('').map(c => c.toUpperCase() === 'O' ? (c === 'o' ? 'q' : 'Q') : c).join('');
        }

        // Extra Quality Check: Suspiciously short/long CDRs
        if (cdr.type === 'CDR3' && (cleanCdrSeq.length < 3 || cleanCdrSeq.length > 35)) {
          needsReview = true;
          reviewReason += ` [Suspicious ${cdr.type} length: ${cleanCdrSeq.length}]`;
        }
        if ((cdr.type === 'CDR1' || cdr.type === 'CDR2') && (cleanCdrSeq.length < 2 || cleanCdrSeq.length > 20)) {
          needsReview = true;
          reviewReason += ` [Suspicious ${cdr.type} length: ${cleanCdrSeq.length}]`;
        }

        // Search for the CDR sequence within the full sequence
        let foundIndex = seq.indexOf(cleanCdrSeq, lastCdrEnd);
        
        // If not found after last CDR, try searching from the beginning 
        if (foundIndex === -1) {
          foundIndex = seq.indexOf(cleanCdrSeq);
        }

        if (foundIndex !== -1) {
          const newStart = foundIndex;
          const newEnd = foundIndex + cleanCdrSeq.length;
          lastCdrEnd = newEnd;
          return { ...cdr, sequence: cleanCdrSeq, start: newStart, end: newEnd };
        }
        
        // CRITICAL: If the verbatim sequence is NOT found in the fullSequence, 
        // we MUST NOT use the hallucinated indices as they will lead to visual mismatch.
        // We flag it for review and set indices to -1 to disable highlighting for this CDR.
        needsReview = true;
        reviewReason += ` [CDR ${cdr.type} sequence "${cleanCdrSeq}" not found in full sequence]`;
        return { ...cdr, sequence: cleanCdrSeq, start: -1, end: -1 };
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
  result.isSarMode = options.isSarMode;
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

/**
 * Orchestrates a multi-step extraction by first surveying relevant pages and then performing targeted analysis.
 */
async function performDeepScanExtraction(
  input: { data: string; mimeType: string },
  options: LLMOptions,
  sequenceListing?: { data: string; mimeType: string },
  prioritySeqIds?: string
): Promise<ExtractionResult> {
  console.log("[Deep Scan] Initiating specialized discovery pass...");
  
  const totalPages = await getPdfPageCount(input.data);
  if (totalPages <= 0) {
    throw new Error("Could not determine page count for Deep Scan.");
  }

  // 1. Discovery Pass - Find where the "meat" is
  let discoveryPages: number[] = [];
  try {
    discoveryPages = await performDiscoveryPass(input, options, totalPages);
    console.log(`[Deep Scan] Discovery pass identified ${discoveryPages.length} potentially relevant pages.`);
  } catch (err) {
    console.warn("[Deep Scan] Discovery pass failed, falling back to incremental scan.", err);
    // Fallback: process every 15 pages to be safe but efficient
    for (let i = 1; i <= totalPages; i += 15) discoveryPages.push(i);
  }

  // 2. Add Default High-Probabilty Pages (Title, metadata, and early tables)
  const mandatoryPages = new Set<number>();
  // First 10 pages usually contain critical title, ID, and early summary tables
  for (let i = 1; i <= Math.min(10, totalPages); i++) mandatoryPages.add(i);
  
  // Last 10 pages (was 5) often contain claims or end of sequence listing
  for (let i = Math.max(1, totalPages - 10); i <= totalPages; i++) mandatoryPages.add(i);

  if (discoveryPages.length === 0) {
    console.warn("[Deep Scan] Discovery pass found nothing. Including broad fallback scan.");
    // Last 15 pages often contain the sequence listing if it's integrated
    for (let i = Math.max(1, totalPages - 25); i <= totalPages; i++) mandatoryPages.add(i);
  }
  
  // Add a 2-page buffer around every discovered page for context (was 1)
  discoveryPages.forEach(p => {
      mandatoryPages.add(Math.max(1, p - 2));
      mandatoryPages.add(Math.max(1, p - 1));
      mandatoryPages.add(p);
      mandatoryPages.add(Math.min(totalPages, p + 1));
      mandatoryPages.add(Math.min(totalPages, p + 2));
  });

  // SAFETY FALLBACK: If discovery pass returned very little for a large document, 
  // we add a distributed scan to ensure we don't miss entire sections.
  if (totalPages > 30 && mandatoryPages.size < 12) {
    console.warn("[Deep Scan] Discovery pass found exceptionally few targets. Adding distributed samples for coverage safety.");
    for (let i = 1; i <= totalPages; i += 15) {
        mandatoryPages.add(i);
        mandatoryPages.add(Math.min(totalPages, i + 1));
    }
  }
  
  // Sort and remove duplicates
  const sortedPages = Array.from(mandatoryPages).sort((a, b) => a - b).filter(p => p > 0 && p <= totalPages);
  
  // 3. Cluster adjacent pages into chunks (to preserve context across page breaks)
  const pageClusters: string[] = [];
  if (sortedPages.length > 0) {
    let currentStart = sortedPages[0];
    let currentPrev = sortedPages[0];
    
    for (let i = 1; i <= sortedPages.length; i++) {
        const p = sortedPages[i];
        // If gap is more than 2 pages (was 3), or cluster exceeds 5 pages (was 25), break it
        // Smaller clusters (max 5 pages) preserve high focus and avoid token pressure/summarization
        if (p === undefined || (p - currentPrev > 2) || (p - currentStart >= 5)) {
            pageClusters.push(`${currentStart}-${currentPrev}`);
            if (p !== undefined) {
                currentStart = p;
                currentPrev = p;
            }
        } else {
            currentPrev = p;
        }
    }
  }

  console.log(`[Deep Scan] Target clusters: ${pageClusters.join(", ")}`);

  const allAntibodies: Antibody[] = [];
  let patentId = "Unknown";
  let patentTitle = "Untitled Patent";
  let totalPromptTokens = 0;
  let totalCandidatesTokens = 0;

  // 4. Chunked Extraction Pass
  // Divide the identified pages into smaller batches to preserve high focus and verbatim accuracy.
  for (let i = 0; i < pageClusters.length; i++) {
    const range = pageClusters[i];
    console.log(`[Deep Scan] Extraction Pass ${i+1}/${pageClusters.length}: Pages ${range}`);
    
    try {
      if (i > 0) await new Promise(resolve => setTimeout(resolve, 2000)); // Rate limit buffer
      
      const chunkResult = await extractWithLLM(
        input, 
        { ...options, isDeepScanMode: false }, // Use standard mode for detailed extraction
        range,
        sequenceListing,
        prioritySeqIds
      );

      if (chunkResult.patentId !== "Unknown") patentId = chunkResult.patentId;
      if (chunkResult.patentTitle !== "Untitled Patent" && chunkResult.patentTitle !== "Untitled") {
        patentTitle = chunkResult.patentTitle;
      }
      
      if (chunkResult.usageMetadata) {
        totalPromptTokens += chunkResult.usageMetadata.promptTokenCount;
        totalCandidatesTokens += chunkResult.usageMetadata.candidatesTokenCount;
      }

      allAntibodies.push(...chunkResult.antibodies);
      console.log(`[Deep Scan] Pass ${i+1} found ${chunkResult.antibodies.length} clones.`);
    } catch (err) {
      console.error(`[Deep Scan] Error in extraction pass ${i+1} (${range}):`, err);
    }
  }

  if (allAntibodies.length === 0) {
    throw new Error("Deep Scan completed but no clones were extracted. Ensure the PDF contains text or high-quality OCR.");
  }

  // 5. Synthesis & Deduplication
  const consolidatedAntibodies = await synthesizeAntibodies(allAntibodies, options);

  return {
    patentId,
    patentTitle,
    antibodies: consolidatedAntibodies,
    modelUsed: options.model,
    isSarMode: options.isSarMode,
    usageMetadata: {
      promptTokenCount: totalPromptTokens,
      candidatesTokenCount: totalCandidatesTokens,
      totalTokenCount: totalPromptTokens + totalCandidatesTokens
    }
  };
}

/**
 * Performs a broad 'scout' pass of the document to find page numbers containing mAb definitions.
 */
async function performDiscoveryPass(
    input: { data: string; mimeType: string },
    options: LLMOptions,
    totalPages: number
): Promise<number[]> {
    const scoutPrompt = `
You are a patent indexing specialist. Your mission is to find ALL page numbers where antibody sequences and clone definitions are located.

CRITICAL TARGETS:
1. TABLES of antibody clones (e.g., "Table 1", "Table 3", "Table 6", "Table 8", "Table 10", "Table 12").
2. SEQUENCE LISTING definitions (where SEQ ID NO: X is followed by a peptide/DNA sequence).
3. mAb identifier lists (e.g., columns labeled "Antibody ID", "Clone Name", "mAb ID", "Antibody Molecule", "Ig ID").
4. CDR definitions (tables mapping SEQ IDs to CDR1, CDR2, CDR3).
5. EXAMPLE sections that list specific clones (e.g., "Example 1", "Example 12").
6. CLAIMS that reference specific SEQ ID NOs or Clone Names.
7. ANY page containing large blocks of single-letter or three-letter amino acids.
8. EXPERIMENTAL RESULTS tables where clone names reappear.

OUTPUT: Return a JSON object with a unique list of relevant page numbers. You MUST identify EVERY page that looks like it has a table or a sequence listing. Do not be conservative. 
Total pages in doc: ${totalPages}.
`;

    const payload = JSON.stringify({
        provider: options.provider,
        model: options.model,
        input: [
            { inlineData: { data: input.data, mimeType: input.mimeType } },
            { text: scoutPrompt }
        ],
        responseSchema: {
            type: "OBJECT",
            properties: {
                relevantPages: {
                    type: "ARRAY",
                    items: { type: "INTEGER" }
                }
            },
            required: ["relevantPages"]
        }
    });

    const result = await executeLLMJob(payload);
    return Array.isArray(result.relevantPages) ? result.relevantPages : [];
}

/**
 * Shared helper for executing an extraction job and polling for completion.
 */
async function executeLLMJob(payload: string): Promise<any> {
    const baseUrl = window.location.origin;
    let startResponse: Response | null = null;
    let postAttempts = 0;
    const maxPostAttempts = 5; // Increased retries

    while (postAttempts < maxPostAttempts) {
        try {
            startResponse = await fetch('/api/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
            });
            
            if (startResponse.status === 429 || startResponse.status === 503) {
                const delay = Math.pow(2, postAttempts) * 1000 + Math.random() * 1000;
                console.warn(`[Extraction] Engine at capacity (${startResponse.status}). Retrying in ${Math.round(delay)}ms...`);
                throw new Error(`Transient status: ${startResponse.status}`);
            }
            break;
        } catch (postError: any) {
            postAttempts++;
            if (postAttempts < maxPostAttempts) {
                const backoff = Math.pow(2, postAttempts - 1) * 2000; // Exponential backoff: 2s, 4s, 8s, 16s
                await new Promise(resolve => setTimeout(resolve, backoff));
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
    let attempts = 0;
    const maxAttempts = 240; // Increased to 20 mins to allow for server-side queuing

    while (attempts < maxAttempts) {
        try {
          const statusResponse = await fetch(`${baseUrl}/api/extract/status/${jobId}?t=${Date.now()}`, {
              cache: 'no-store'
          });
          if (!statusResponse.ok) {
            console.warn(`[Extraction] Status check failed (${statusResponse.status}). Retrying...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            attempts++;
            continue;
          }

          const job = await statusResponse.json();
          if (job.status === 'completed') return job.result;
          if (job.status === 'failed') throw new Error(job.error || 'Job failed');
          
          if (attempts % 6 === 0) { // Log every 30 seconds
            console.log(`[Job ${jobId}] Status: ${job.status}...`);
          }
        } catch (e: any) {
          if (e.message?.includes('failed') || e.message?.includes('check failed')) {
            // Keep going unless it's a hard failure
          } else {
            throw e;
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        attempts++;
    }
    throw new Error("Job timed out while waiting for AI engine. This can happen during high traffic or for very large documents.");
}

/**
 * Uses the LLM to synthesize and deduplicate antibodies found across multiple chunks.
 */
async function synthesizeAntibodies(antibodies: Antibody[], options: LLMOptions): Promise<Antibody[]> {
  // If we have very few antibodies, we can potentially skip LLM synthesis and just do basic merging
  if (antibodies.length < 3) return antibodies;

  // For very long lists, we might need to chunk the synthesis too, but let's start with a single pass
  const summaryPayload = antibodies.map(a => ({
    name: a.mAbName,
    summary: a.summary,
    chains: a.chains.map(c => ({ 
      type: c.type, 
      seqId: c.seqId, 
      target: c.target,
      len: c.fullSequence.length,
      // We don't send full sequences to synthesis as it's too much data, 
      // but we send enough to identify if they are duplicates
      head: c.fullSequence.substring(0, 10),
      tail: c.fullSequence.slice(-10)
    }))
  }));

  const synthPrompt = `
You are a master antibody data synthesizer. Your task is to merge and deduplicate a list of antibody components extracted from different parts of a large patent.

INPUT DATA: A list of monoclonal antibodies (mAbs) and their chains. Some entries might be duplicates (same name, same sequences), and some might be partials (e.g., mAb 1 with only a Heavy chain in one entry and mAb 1 with only a Light chain in another).

RULES:
1. Deduplicate by mAbName and Sequence identity.
2. If two entries have the same mAbName, MERGE their chains.
3. If a name is "mAb 1" and another is "mAb 1 (REGN7075)", they are likely the same. Use the most descriptive name.
4. Ensure every monoclonal antibody represents a unique clone.
5. If sequences are slightly different (OCR errors), use the one with higher precision (e.g. from sequence listing).

OUTPUT: Return a JSON array of the original indices that should be merged or kept. 
Actually, to keep it simple and avoid another LLM call with a complex schema, let's perform a programmatic merge first.
`;

  // Programmatic merge based on name and sequence characteristics
  const merged = new Map<string, Antibody>();
  
  for (const mAb of antibodies) {
    // Normalize name for keying
    const nameKey = mAb.mAbName.toLowerCase().replace(/[\s\-_]/g, '');
    
    // We try to find an existing entry with the same name first
    // If name matches, we check if the sequences are compatible
    let existingKey: string | null = null;
    
    for (const [key, existing] of merged.entries()) {
        const existingNameKey = existing.mAbName.toLowerCase().replace(/[\s\-_]/g, '');
        // Exact name match or one is a subset of another (e.g. "2A6" and "mAb 2A6")
        if (existingNameKey === nameKey || 
            (nameKey.length > 2 && existingNameKey.includes(nameKey)) ||
            (existingNameKey.length > 2 && nameKey.includes(existingNameKey))) {
            
            // Check sequence compatibility
            const newVh = mAb.chains.find(c => c.type === 'Heavy');
            const newVl = mAb.chains.find(c => c.type === 'Light');
            const extVh = existing.chains.find(c => c.type === 'Heavy');
            const extVl = existing.chains.find(c => c.type === 'Light');
            
            let compatible = true;
            // If both have Heavy chains, they must be similar
            if (newVh && extVh) {
                const s1 = newVh.fullSequence.substring(0, 30);
                const s2 = extVh.fullSequence.substring(0, 30);
                if (s1 !== s2 && !s1.includes(s2) && !s2.includes(s1)) compatible = false;
            }
            // If both have Light chains, they must be similar
            if (newVl && extVl && compatible) {
                const s1 = newVl.fullSequence.substring(0, 30);
                const s2 = extVl.fullSequence.substring(0, 30);
                if (s1 !== s2 && !s1.includes(s2) && !s2.includes(s1)) compatible = false;
            }
            
            if (compatible) {
                existingKey = key;
                break;
            }
        }
    }
    
    if (existingKey) {
      const existing = merged.get(existingKey)!;
      // Merge chains
      for (const newChain of mAb.chains) {
        const existingChain = existing.chains.find(c => c.type === newChain.type);
        if (existingChain) {
            // Keep the longer/better sequence
            if (newChain.fullSequence.length > existingChain.fullSequence.length) {
                const index = existing.chains.indexOf(existingChain);
                existing.chains[index] = newChain;
            }
        } else {
            existing.chains.push(newChain);
        }
      }
      
      // Prefer the more descriptive name
      if (mAb.mAbName.length > existing.mAbName.length) {
          existing.mAbName = mAb.mAbName;
      }

      // Combine metadata
      if (mAb.summary && !existing.summary.includes(mAb.summary.substring(0, 20))) {
        existing.summary += " | " + mAb.summary;
      }
      if (mAb.evidenceLocation && !existing.evidenceLocation?.includes(mAb.evidenceLocation)) {
        existing.evidenceLocation += ", " + mAb.evidenceLocation;
      }
      existing.confidence = Math.max(existing.confidence, mAb.confidence);
      
      // Merge SAR data if exists
      if (mAb.experimentalData) {
          existing.experimentalData = [...(existing.experimentalData || []), ...mAb.experimentalData];
      }
    } else {
      // Create a stable key for this new entry
      const vh = mAb.chains.find(c => c.type === 'Heavy');
      const vl = mAb.chains.find(c => c.type === 'Light');
      const vhProfile = vh ? vh.fullSequence.substring(0, 40) : "no_vh";
      const vlProfile = vl ? vl.fullSequence.substring(0, 40) : "no_vl";
      const finalKey = `${nameKey}_${vhProfile}_${vlProfile}`;
      merged.set(finalKey, { ...mAb });
    }
  }

  return Array.from(merged.values());
}

/**
 * Converts three-letter amino acid codes to one-letter codes.
 * e.g. "GluValGln" -> "EVQ"
 */
function convertThreeLetterToOneLetter(seq: string): string {
    const map: { [key: string]: string } = {
        'ALA': 'A', 'ARG': 'R', 'ASN': 'N', 'ASP': 'D', 'CYS': 'C',
        'GLN': 'Q', 'GLU': 'E', 'GLY': 'G', 'HIS': 'H', 'ILE': 'I',
        'LEU': 'L', 'LYS': 'K', 'MET': 'M', 'PHE': 'F', 'PRO': 'P',
        'PRQ': 'P', 'PRP': 'P', 'TRP': 'W', 'TYR': 'Y', 'VAL': 'V',
        'SER': 'S', 'THR': 'T', 'ASX': 'B', 'GLX': 'Z', 'XAA': 'X',
        'GLQ': 'Q'
    };

    // Clean all punctuation and remove numbers, but keep characters
    const clean = seq.replace(/[\d\s\.\-]/g, '').toUpperCase();
    
    let result = '';
    // Use a sliding window to find triplets if joined without fixed structure
    for (let i = 0; i <= clean.length - 3; i += 3) {
        const triplet = clean.substring(i, i + 3);
        result += map[triplet] || '?';
    }
    
    // If it was already single letter but accidentally passed in, the map will return many '?'
    // result would be roughly 1/3 of the length. 
    // If the map fails significantly, it's either not a sequence or already single letter.
    const unknownCount = (result.match(/\?/g) || []).length;
    if (unknownCount > result.length / 2 || result.length < 5) {
        return seq; 
    }
    
    return result.replace(/\?/g, 'X');
}
