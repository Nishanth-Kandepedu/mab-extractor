import { ExtractionResult, Antibody } from "../types";
import { getPdfPages, getPdfPageCount } from "../lib/pdf";

export const SYSTEM_INSTRUCTION = `You are an expert in high-quality antibody sequence mining from patent documents. 
Your goal is 100% Verbatim Accuracy and 100% Coverage.

IMPORTANT EXTRACTION RULES:

1. Antibody Naming:
   - Main antibodies: "2419", "3125", etc.
   - Variants: "2419-0105", "2419-1204", "4540-033", etc.
   - Treat variants as SEPARATE antibodies with their own VH/VL chains.

2. SINGLE DOMAIN / VHH HANDLING (Nanobodies): 
   - Some patents describe VHH or Single Domain antibodies (Nanobodies).
   - These consist ONLY of a Heavy (VH) chain. DO NOT attempt to find a Light (VL) chain for these.
   - TABLE HINT: If a table lists "VHH", treat it as a standalone Heavy chain.
   - VALIDATION: A VHH antibody object MUST contain exactly ONE "Heavy" chain in the chains array. NEVER create a placeholder Light chain for VHH.

3. VL Chain Special Handling:
   - VL chains may appear in a DIFFERENT TABLE than VH chains.
   - VL sequences are typically 110-120 amino acids long.
   - If VL appears incomplete, check the next page or table.

4. Validation & Domain Boundary:
   - VH sequences: typically 115-125 amino acids. Ends with conserved "WGXG" motif (Framework 4).
   - VL sequences: typically 110-120 amino acids. Ends with conserved "FGXG" motif (Framework 4).
   - VARIABLE DOMAIN ONLY (Fv): You MUST only extract the Variable Domain. Do NOT include the Constant Region (CH1, CH2, CH3, CL, or Hinges).
   - DISCARD CONSERVED REGIONS: Sequences starting with "ASTKGP..." (CH1) or "RTVAAP..." (CL) are CONSTANT REGIONS and must be excluded. 
   - TRUNCATION RULE: Truncate the sequence immediately after the J-segment motifs:
     * VH: Ends after ...VTVSS or ...WGXG.
     * VL (Kappa/Lambda): Ends after ...VEIK, ...VFGXG, or ...FGGGTK.
   - If the source contains the full chain, you MUST truncate it to the variable domain (max ~130 AA). Anything beyond the J-motif (VTVSS/VEIK) is a constant region and MUST be deleted from the extracted sequence. Extract ONLY the Fv.
   - LENGTH LIMIT: High-quality variable domains are NEVER longer than 135 AA. If you find a sequence that looks longer, you are likely failing to identify the J-motif/Constant Region boundary. Re-examine and truncate.

5. Table Structure & Coverage:
    - TABLE-FIRST PROTOCOL: You MUST perform an exhaustive scan of every Table (e.g., Table 1, Table 3, Table 6) before processing summarizing text. Tables are the source of truth for the complete list of clones.
    - Some antibodies may have their sequences split across multiple rows or pages.
    - For antibodies like "2419-1204", ensure you capture the COMPLETE Variable Domain sequence.
    - Check for table headers like "SEQ ID NO", "VH", "VL" to identify columns.
    - MANDATORY: Extract every single clone/antibody listed in a table. Do not stop after the first few. If a table spans multiple pages, continue extraction until the end of the table.
    - HIGH-VOLUME CLONES: Scale your throughput. Use very concise descriptions in the "summary" field (max 10 words). Focus 100% on verbatim Amino Acid sequence accuracy for every row in the clones table.

6. Mandatory SEQ ID & Evidence:
    - You MUST extract the "SEQ ID NO" for every sequence found.
    - Capture the exact page number and table ID (if applicable) for every sequence.
    - The "evidenceStatement" should include the SEQ ID, page, and table coordinates.

7. Target Identification: Every antibody sequence has a primary binding target (antigen) (e.g., HER2, PD-L1, CD20, IFN-gamma). 
    - CRITICAL: Distinguish between the DIRECT BINDING TARGET (antigen) and any downstream signaling molecules, receptors, or ligands.
    - RECEPTOR VS LIGAND: Be extremely careful not to swap the receptor and ligand. If the antibody binds to "CD3", its target is "CD3" (or "CD3E/P07766"), NOT the other arm's target (like MICA) or the cell it's on.
    - Example: In a bispecific "Anti-CD3 x Anti-MICA", the CD3-binding arm has target "CD3", and the MICA-binding arm has target "MICA". DO NOT assign "MICA" to both.
    - Example: If an antibody blocks "IFN-gamma signaling" and the patent measures "STAT1 phosphorylation", the target is "IFN-gamma", NOT "STAT1".
    - You must extract the antigen that the antibody is designed to bind to. 
    - Include this target in every chain object.

8. ID-Mapping & Cross-Referencing Strategy: 
    - First, identify every unique mAb ID (e.g., "mAb 1", "2419") from the tables. You MUST extract sequences for every ID found.
    - CROSS-REFERENCE: Many antibodies have multiple names (e.g., "mAb 1" is "REGN7075"). You MUST map these names together in the "mAbName" field (e.g., "mAb 1 (REGN7075)") or ensure both are mentioned in the summary.
    - ANTI-LAZINESS: Do NOT rely on candidate summaries in the text which often omit the "parental" clones listed in the tables. If a clone exists in a table, it MUST be in your output.

9. Chain-by-Chain Verification: Treat every Heavy (VH) and Light (VL) chain as a standalone high-quality mining task. After extracting a sequence, internally re-read the source text to verify every single amino acid.
10. Length-Check Validation: For every sequence extracted, verify that the character count matches the source Variable Domain exactly. Do not truncate or "summarize" variable sequences, but do exclude constant regions.
11. VL Chain Priority: Given the higher historical error rate in VL chains, dedicate extra reasoning cycles to the Light chain variable regions.
12. Source Priority: Always use "Sequence Listings" as the primary source of truth for character accuracy over table text.
13. CDR Identification: Identify CDR1, CDR2, and CDR3 based on standard numbering (IMGT/Kabat).
14. Non-Standard Amino Acids: If you encounter letters other than the standard 20 (ACDEFGHIKLMNPQRSTVWY), extract them exactly as they appear. The system will flag them later.
15. Amino Acid Format:
    - Use ONLY single-letter amino acid codes (e.g., A, C, D, E...).
    - DO NOT USE three-letter codes (e.g., Ala, Cys, Asp, Glu, GLY). If the document uses three-letter codes, you MUST convert them to single-letter codes in your output.
    - If a sequence contains spaces or other punctuation, CLEAN IT.
    - VERBATIM ACCURACY: You must never summarize or approximate a sequence. Every character must match the source exactly.
16. Return the data in valid JSON format.
17. CRITICAL: Ensure the JSON is valid and complete.

18. BISPECIFIC & MULTISPECIFIC HANDLING:
    - Many patents describe bispecific antibodies (e.g., EGFR x CD28). 
    - You MUST look for components of BOTH binding arms.
    - If the patent title mentions two targets (A x B), you are not finished until you have extracted sequences for both Target A and Target B components.
    - CROSS-TABLE SEARCH: Sequence data for different arms often reside in separate tables or pages. You MUST search the entire provided text/listing to connect them.
    - LABELING: In the "summary" or "mAbName", clearly indicate if a sequence belongs to "Arm 1", "Arm 2", "Target A", or "Target B". 
    - COMMON LIGHT CHAIN: If a bispecific uses a common light chain, Ensure that light chain is associated with both Heavy chain components in the final JSON.

19. TABLE SCANNING HIERARCHY:
    - STEP 1: Scan Table 1 & Table 3 for "Parental" antibodies (e.g., mAb12999P2, mAb14226). These MUST be extracted as separate entries.
    - STEP 2: Scan Table 6 (or equivalent) for "Bispecific/Multi-specific" assemblies (e.g., bsAb7075, REGN7075).
    - STEP 3: Ensure every ID mentioned in these tables is cross-referenced with the Sequence Listing for verbatim accuracy.
    - STEP 4: If a clone name like "mAb12999P2" appears in any table, it MUST be extracted. Do NOT skip parental clones just because they are part of a larger multispecific assembly. Every clone ID in Table 1 and Table 3 is a mandatory mining target.

20. PARENTAL VS COMPONENT CLONES:
    - When a Bispecific antibody (bsAb) is made of two parental antibodies (mAbs), you MUST extract the parental mAbs individually AND the bispecific assembly. 
    - Total coverage means if Table 1 has 10 mAbs and Table 6 has 5 bsAbs, your output should contain at least 15 antibody objects.

21. EPITOPE, TARGET SPECIES & ANTIBODY ORIGIN:
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
  isExtendedMode?: boolean; // New option for high-volume session stability
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
  prioritySeqIds?: string,
  signal?: AbortSignal
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
    formattedInput = `Extract ALL antibody sequences including Parental mAbs (Table 1/3) and Bispecifics (Table 6).${contextPrompt}${priorityPrompt}\n\nANTI-LAZINESS RULE: You must identify and extract every unique mAb/clone ID mentioned in the document. Do not omit any parental clones. Maintain 100% verbatim accuracy for sequences.\n\n${input}`;
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
      parts.push({ text: `Extract all sequences from the patent and sequence listing.${contextPrompt}${priorityPrompt}\n\nANTI-LAZINESS RULE: Identify every Parental clone in Tables 1/3 and every Bispecific in Table 6. Extract all separately. Even if there are 100+ clones, you MUST represent every one of them in the output. Verbatim accuracy is mandatory.` });
    } else {
      parts.push({ text: `Extract all antibody sequences.${contextPrompt}${priorityPrompt}\n\nANTI-LAZINESS RULE: Form an exhaustive list of every unique mAb ID in Tables 1/3 and every bsAb in Table 6. Extract each one separately. Do not summarize or skip any clones. High-volume coverage is required.` });
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
      isExtendedMode: options.isExtendedMode,
      thinkingLevel: (options.isExtendedMode && (model?.includes('3.1') || isGemma4)) ? "HIGH" : "MINIMAL",
      responseSchema: responseSchema,
    });

    console.log(`[Extraction] Initiating fetch. Payload size: ${payload.length} bytes. Mode: ${options.isExtendedMode ? 'Extended' : 'Normal'}`);
    if (payload.length > 1000000) {
      console.warn("[Extraction] Payload size exceeds 1MB. This may be blocked by some proxies on custom domains.");
    }

    // Increased timeout: 30 mins for extended mode, 15 mins for normal
    const timeoutMs = options.isExtendedMode ? 1800000 : 900000;
    const { patentId, patentTitle, antibodies, usageMetadata } = await executeLLMJob(payload, timeoutMs, signal);
  
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
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('aborted') || msg.includes('proxy mirror timeout')) {
      throw new Error("Proxy Timeout: The extraction link was interrupted. This usually happens when patents have 'too many clones' or the output is extremely large. We've increased the session timeout. Try enabling 'Extended Mode' or using a smaller page range if this persists.");
    }
    throw e;
  }
}

/**
 * Shared helper for executing an extraction job and polling for completion.
 */
async function executeLLMJob(payload: string, timeoutMs: number = 600000, signal?: AbortSignal): Promise<any> {
    const baseUrl = window.location.origin;
    const startTime = Date.now();
    let startResponse: Response | null = null;
    let postAttempts = 0;
    const maxPostAttempts = 5;

    while (postAttempts < maxPostAttempts) {
        if (signal?.aborted) throw new Error("Operation cancelled by user.");
        if (Date.now() - startTime > timeoutMs) {
            throw new Error("Timeout: Failed to initiate extraction within the allowed time window.");
        }
        try {
            startResponse = await fetch('/api/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                signal
            });
            
            if (startResponse.status === 429 || startResponse.status === 503) {
                const delay = Math.pow(2, postAttempts) * 1000 + Math.random() * 1000;
                console.warn(`[Extraction] Engine at capacity (${startResponse.status}). Retrying in ${Math.round(delay)}ms...`);
                throw new Error(`Transient status: ${startResponse.status}`);
            }
            break;
        } catch (postError: any) {
            if (postError.name === 'AbortError') throw postError;
            postAttempts++;
            if (postAttempts < maxPostAttempts) {
                const backoff = Math.pow(2, postAttempts - 1) * 2000;
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
    const POLLING_INTERVAL = 5000;
    const maxAttempts = Math.ceil(timeoutMs / POLLING_INTERVAL); 

    while (attempts < maxAttempts) {
        if (signal?.aborted) throw new Error("Operation cancelled by user.");
        if (Date.now() - startTime > timeoutMs) {
            throw new Error(`Timeout: Extraction job ${jobId} exceeded the ${Math.round(timeoutMs/60000)} minute time limit.`);
        }
        try {
          const statusResponse = await fetch(`${baseUrl}/api/extract/status/${jobId}?t=${Date.now()}`, {
              cache: 'no-store',
              signal
          });
          
          if (statusResponse.status === 404) {
            // Transient 404: The server might be slow to write the job state to disk/Firestore
            if (attempts > 5) throw new Error("Job state lost. The server may have restarted.");
            console.warn(`[Extraction] Job ${jobId} not found yet. Retrying...`);
            await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
            attempts++;
            continue;
          }

          if (!statusResponse.ok) {
            console.warn(`[Extraction] Status check failed (${statusResponse.status}). Retrying...`);
            await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
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
          if (e.name === 'AbortError') throw e;
          if (e.message?.includes('failed') || e.message?.includes('check failed')) {
            // Keep going unless it's a hard failure
          } else {
            throw e;
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
        attempts++;
    }
    throw new Error(`Job timed out while waiting for AI engine after ${Math.round(timeoutMs/60000)} minutes.`);
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
