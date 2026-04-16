import { ExtractionResult } from "../types";

export const SYSTEM_INSTRUCTION = `You are an expert patent analyst specializing in therapeutic antibody extraction. Your task is to extract specific data points from antibody patent documents and return them in a structured JSON format.

CRITICAL INSTRUCTIONS:
1. Extract ONLY information explicitly stated in the patent document.
2. If a data point is not found, return null (do not guess or infer).
3. Maintain exact terminology from the patent (e.g., if patent says "PD-1", don't change to "PDCD1").
4. For numerical values, include units exactly as stated.
5. Return results as valid JSON only.

EXTRACTION GUIDELINES:

TARGET ANTIGEN:
- Look in: Title, Abstract, Claims, Background, Summary.
- Search patterns: "antibodies to [X]", "binds [X]", "anti-[X] antibody", "[X] antagonist".
- Include official gene names, protein names, and common aliases.
- Note species (human, mouse, etc.).

STRUCTURE-ACTIVITY RELATIONSHIPS (SAR):
- Look in: Examples, Tables comparing variants, "Surprisingly found that...".
- Extract: Specific mutations and their effects on binding/function.
- Focus on: CDR mutations, framework mutations, Fc mutations.
- Quantify effects when possible (e.g., "10-fold improvement").

SURFACE PLASMON RESONANCE (SPR) / BINDING KINETICS:
- Look in: Examples, Tables titled "Binding", "Kinetics", "Affinity".
- Search for: KD, Kd, kon, koff, Ka, Kd values.
- Units: nM, pM, μM, M⁻¹s⁻¹, s⁻¹.
- Methods: Biacore, Proteon, FortéBio, KinExA.
- Extract conditions: temperature, pH, buffer.

ADME/DMPK:
- Look in: Examples (often titled "Pharmacokinetics", "PK Study").
- Half-life: Look for t½, t1/2, terminal half-life.
- Clearance: CL, clearance values.
- Bioavailability: F%, bioavailability.
- Species: human, mouse, rat, monkey, cynomolgus.
- Routes: IV (intravenous), SC (subcutaneous), IP.
- Immunogenicity: ADA (anti-drug antibodies), immunogenic response.
- Stability: aggregation, degradation, shelf-life data.

EPITOPE:
- Look in: Examples with "epitope mapping", "binding residues", "crystal structure".
- Methods: X-ray crystallography, cryo-EM, HDX-MS, alanine scanning, mutagenesis.
- Extract: Specific residues involved in binding.
- Competition data: Which antibodies block each other (epitope binning).
- Linear vs conformational epitopes.

MANUFACTURING & DEVELOPMENT:
- Look in: Examples titled "Production", "Expression", "Purification", "Formulation".
- Expression systems: CHO (most common), HEK293, NSO, E.coli, yeast, Pichia.
- Cell lines: Specific names (e.g., CHO-K1, CHO-S, HEK293T).
- Yields: g/L or mg/L from culture.
- Purification: Protein A is standard first step, followed by polishing steps.
- Formulation: Buffer type (phosphate, histidine, acetate), pH, concentration.
- Quality: Aggregation levels, purity, endotoxin.
- Stability: Storage conditions, shelf-life.

ANTIBODY SEQUENCES (CRITICAL):
- Extract VH and VL sequences verbatim.
- Identify CDRs (CDR1, CDR2, CDR3) based on standard numbering.
- Capture SEQ ID NOs for every sequence.
- VL sequences are typically 110-120 amino acids.
- VH sequences are typically 115-125 amino acids.

EXTRACTION RULES:
1. ONLY extract data explicitly stated in the document.
2. Do NOT infer or extrapolate.
3. Preserve exact terminology and units from the patent.
4. For ambiguous data, mark confidence as "low".
5. If multiple values exist for the same parameter, extract all with context.
6. Link each extracted value to its source location (Example number, Table number, Page).
7. If comparing multiple antibodies, create separate entries for each.

COMMON PITFALLS TO AVOID:
- Do not confuse IC50 (functional assay) with KD (binding affinity).
- Do not mix data from different species (human vs mouse).
- Do not merge data from different assay conditions.
- Do not extract data from "comparative examples" of non-invention antibodies.
- Pay attention to units (nM vs pM is 1000x difference).
- Distinguish between in vitro and in vivo data.`;

export type LLMProvider = 'gemini' | 'openai' | 'anthropic';

export interface LLMOptions {
  provider: LLMProvider;
  model?: string;
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
  sequenceListing?: { data: string; mimeType: string }
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
  let formattedInput: any;

  if (typeof input === "string") {
    formattedInput = `Extract ALL mAb sequences from the following text.${contextPrompt}\n\nNote: Ensure EVERY antibody ID is captured and sequences are verbatim.\n\n${input}`;
  } else {
    // For non-Gemini providers, we currently only support text
    if (provider !== 'gemini') {
      throw new Error(`File upload is currently only supported for Gemini. Please switch to Gemini or paste the text directly.`);
    }
    
    const parts: any[] = [
      {
        inlineData: {
          data: input.data,
          mimeType: input.mimeType,
        },
      }
    ];

    if (sequenceListing) {
      parts.push({
        inlineData: {
          data: sequenceListing.data,
          mimeType: sequenceListing.mimeType,
        },
      });
      parts.push({ text: `Extract detailed antibody data from the provided patent document and sequence listing file.${contextPrompt} Use the sequence listing as the primary source for character accuracy, and the patent document for context (mAb names, target, SAR, SPR, ADME, epitope, manufacturing, etc.). Perform high-quality verbatim mining.` });
    } else {
      parts.push({ text: `Extract detailed antibody data from this document.${contextPrompt} Perform high-quality verbatim mining.` });
    }

    formattedInput = parts;
  }

    const payload = JSON.stringify({
      provider,
      model,
      input: formattedInput,
      systemInstruction: SYSTEM_INSTRUCTION,
      thinkingLevel: model?.includes('3.1') ? "HIGH" : undefined,
      responseSchema: {
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
                antibody_id: { type: "STRING", nullable: true },
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
                    required: ["type", "fullSequence", "cdrs", "seqId", "pageNumber"],
                  },
                },
                target: {
                  type: "OBJECT",
                  nullable: true,
                  properties: {
                    antigen_name: { type: "STRING", nullable: true },
                    antigen_aliases: { type: "ARRAY", items: { type: "STRING" }, nullable: true },
                    species: { type: "STRING", nullable: true },
                    confidence: { type: "STRING", enum: ["high", "medium", "low"], nullable: true }
                  }
                },
                sar: {
                  type: "OBJECT",
                  nullable: true,
                  properties: {
                    structure_activity_relationships: {
                      type: "ARRAY",
                      nullable: true,
                      items: {
                        type: "OBJECT",
                        properties: {
                          mutation_position: { type: "STRING", nullable: true },
                          mutation_type: { type: "STRING", nullable: true },
                          effect_on_binding: { type: "STRING", nullable: true },
                          effect_magnitude: { type: "STRING", nullable: true },
                          evidence: { type: "STRING", nullable: true }
                        }
                      }
                    },
                    key_residues: {
                      type: "ARRAY",
                      nullable: true,
                      items: {
                        type: "OBJECT",
                        properties: {
                          position: { type: "STRING", nullable: true },
                          residue: { type: "STRING", nullable: true },
                          importance: { type: "STRING", nullable: true },
                          evidence: { type: "STRING", nullable: true }
                        }
                      }
                    }
                  }
                },
                spr: {
                  type: "OBJECT",
                  nullable: true,
                  properties: {
                    kon: {
                      type: "OBJECT",
                      nullable: true,
                      properties: {
                        value: { type: "NUMBER", nullable: true },
                        unit: { type: "STRING", nullable: true },
                        method: { type: "STRING", nullable: true },
                        conditions: { type: "STRING", nullable: true }
                      }
                    },
                    koff: {
                      type: "OBJECT",
                      nullable: true,
                      properties: {
                        value: { type: "NUMBER", nullable: true },
                        unit: { type: "STRING", nullable: true },
                        method: { type: "STRING", nullable: true },
                        conditions: { type: "STRING", nullable: true }
                      }
                    },
                    kd: {
                      type: "OBJECT",
                      nullable: true,
                      properties: {
                        value: { type: "NUMBER", nullable: true },
                        unit: { type: "STRING", nullable: true },
                        method: { type: "STRING", nullable: true },
                        conditions: { type: "STRING", nullable: true }
                      }
                    },
                    affinity_comparisons: {
                      type: "ARRAY",
                      nullable: true,
                      items: {
                        type: "OBJECT",
                        properties: {
                          antibody_name: { type: "STRING", nullable: true },
                          kd_value: { type: "NUMBER", nullable: true },
                          kd_unit: { type: "STRING", nullable: true },
                          comparison: { type: "STRING", nullable: true }
                        }
                      }
                    }
                  }
                },
                adme_dmpk: {
                  type: "OBJECT",
                  nullable: true,
                  properties: {
                    half_life: {
                      type: "OBJECT",
                      nullable: true,
                      properties: {
                        value: { type: "NUMBER", nullable: true },
                        unit: { type: "STRING", nullable: true },
                        species: { type: "STRING", nullable: true },
                        route: { type: "STRING", nullable: true },
                        dose: { type: "STRING", nullable: true }
                      }
                    },
                    clearance: {
                      type: "OBJECT",
                      nullable: true,
                      properties: {
                        value: { type: "NUMBER", nullable: true },
                        unit: { type: "STRING", nullable: true },
                        species: { type: "STRING", nullable: true }
                      }
                    },
                    bioavailability: {
                      type: "OBJECT",
                      nullable: true,
                      properties: {
                        value: { type: "NUMBER", nullable: true },
                        unit: { type: "STRING", nullable: true },
                        route: { type: "STRING", nullable: true }
                      }
                    },
                    volume_of_distribution: {
                      type: "OBJECT",
                      nullable: true,
                      properties: {
                        value: { type: "NUMBER", nullable: true },
                        unit: { type: "STRING", nullable: true },
                        species: { type: "STRING", nullable: true }
                      }
                    },
                    immunogenicity: {
                      type: "OBJECT",
                      nullable: true,
                      properties: {
                        ada_positive_rate: { type: "STRING", nullable: true },
                        species: { type: "STRING", nullable: true },
                        duration: { type: "STRING", nullable: true },
                        clinical_impact: { type: "STRING", nullable: true }
                      }
                    },
                    stability: {
                      type: "OBJECT",
                      nullable: true,
                      properties: {
                        formulation: { type: "STRING", nullable: true },
                        storage_conditions: { type: "STRING", nullable: true },
                        shelf_life: { type: "STRING", nullable: true },
                        aggregation_data: { type: "STRING", nullable: true }
                      }
                    }
                  }
                },
                epitope: {
                  type: "OBJECT",
                  nullable: true,
                  properties: {
                    epitope_type: { type: "STRING", nullable: true },
                    binding_residues: {
                      type: "ARRAY",
                      nullable: true,
                      items: {
                        type: "OBJECT",
                        properties: {
                          residue_position: { type: "STRING", nullable: true },
                          interaction_type: { type: "STRING", nullable: true },
                          evidence_method: { type: "STRING", nullable: true }
                        }
                      }
                    },
                    epitope_sequence: { type: "STRING", nullable: true },
                    competitive_binding: {
                      type: "ARRAY",
                      nullable: true,
                      items: {
                        type: "OBJECT",
                        properties: {
                          competitor_antibody: { type: "STRING", nullable: true },
                          blocks_binding: { type: "BOOLEAN", nullable: true },
                          evidence: { type: "STRING", nullable: true }
                        }
                      }
                    },
                    epitope_bin: { type: "STRING", nullable: true }
                  }
                },
                manufacturing: {
                  type: "OBJECT",
                  nullable: true,
                  properties: {
                    expression_system: {
                      type: "OBJECT",
                      nullable: true,
                      properties: {
                        host_cell: { type: "STRING", nullable: true },
                        cell_line_name: { type: "STRING", nullable: true },
                        vector_type: { type: "STRING", nullable: true },
                        promoter: { type: "STRING", nullable: true }
                      }
                    },
                    production_yield: {
                      type: "OBJECT",
                      nullable: true,
                      properties: {
                        value: { type: "NUMBER", nullable: true },
                        unit: { type: "STRING", nullable: true },
                        culture_duration: { type: "STRING", nullable: true },
                        culture_conditions: { type: "STRING", nullable: true }
                      }
                    },
                    purification: {
                      type: "OBJECT",
                      nullable: true,
                      properties: {
                        methods: { type: "ARRAY", items: { type: "STRING" }, nullable: true },
                        final_purity: { type: "STRING", nullable: true },
                        endotoxin_level: { type: "STRING", nullable: true }
                      }
                    },
                    formulation: {
                      type: "OBJECT",
                      nullable: true,
                      properties: {
                        buffer_composition: { type: "STRING", nullable: true },
                        ph: { type: "STRING", nullable: true },
                        concentration: { type: "STRING", nullable: true },
                        excipients: { type: "ARRAY", items: { type: "STRING" }, nullable: true },
                        preservatives: { type: "ARRAY", items: { type: "STRING" }, nullable: true }
                      }
                    },
                    quality_attributes: {
                      type: "OBJECT",
                      nullable: true,
                      properties: {
                        aggregation_level: { type: "STRING", nullable: true },
                        charge_variants: { type: "STRING", nullable: true },
                        glycosylation_profile: { type: "STRING", nullable: true },
                        potency: { type: "STRING", nullable: true }
                      }
                    },
                    scalability: {
                      type: "OBJECT",
                      nullable: true,
                      properties: {
                        largest_scale_tested: { type: "STRING", nullable: true },
                        yield_consistency: { type: "STRING", nullable: true }
                      }
                    }
                  }
                },
                source_evidence: {
                  type: "OBJECT",
                  nullable: true,
                  properties: {
                    target_source: { type: "STRING", nullable: true },
                    sar_source: { type: "STRING", nullable: true },
                    spr_source: { type: "STRING", nullable: true },
                    adme_dmpk_source: { type: "STRING", nullable: true },
                    epitope_source: { type: "STRING", nullable: true },
                    manufacturing_source: { type: "STRING", nullable: true }
                  }
                },
                confidence: { type: "NUMBER" },
                summary: { type: "STRING" },
                evidenceLocation: { type: "STRING" },
                evidenceStatement: { type: "STRING" },
                needsReview: { type: "BOOLEAN" },
                reviewReason: { type: "STRING" },
              },
              required: ["mAbName", "chains", "confidence", "summary"],
            },
          },
        },
        required: ["patentId", "patentTitle", "antibodies"],
      },
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
