# AbMiner Rebuild & Handover Protocol
This document serves as a complete blueprint to recreate the identical and optimized functional version of **AbMiner** on any AI coding platform (e.g., Google AI Studio, cursor, or windsurf). Use the prompt recipes and algorithmic specs below to regenerate the exact state engine, backend proxies, database sync, and high-accuracy curation checks.

---

## 1. Project Architecture Blueprint

### Directory Hierarchy
```text
├── package.json              # Configuration, scripts (tsx server.ts, vite build)
├── index.html                # App title: "AbMiner | Cheminformatic Labs"
├── metadata.json             # Frame capabilities
├── src/
│   ├── main.tsx              # React bootstrap
│   ├── App.tsx               # State coordinator, Admin dashboard, Core forms
│   ├── index.css             # Tailwind config and Inter / JetBrains Mono imports
│   ├── types.ts              # Robust static typing contracts
│   ├── firebase.ts           # Firebase connection layer (Auth and Firestore)
│   ├── lib/
│   │   ├── pdf.ts            # Page selections and physical crop operations
│   │   └── sqlExport.ts      # SQL dump logic
│   ├── services/
│   │   ├── llm.ts            # Polling engines, JSON repair systems, J-Motifs
│   │   └── uniprot.ts        # UniProt API hooks for target metadata matching
│   └── components/
│       └── SequenceDisplay.tsx # Visualization rendering mapped CDR1/2/3s
```

### Dependency Stack (`package.json`)
```json
{
  "dependencies": {
    "@google/genai": "^1.29.0",
    "firebase": "^12.11.0",
    "firebase-admin": "^13.8.0",
    "express": "^4.21.2",
    "motion": "^12.23.24",
    "papaparse": "^5.5.3",
    "pdf-lib": "^1.17.1",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^3.5.0",
    "clsx": "^2.1.1",
    "tsx": "^4.21.0",
    "vite": "^6.2.0"
  }
}
```

---

## 2. Extraction Accuracy Core Algorithms
*To ensure the applet does not lose its target molecular curation accuracy, reproduce these deterministic pre- and post-processing steps inside `src/services/llm.ts` or helper modules.*

### A. Three-Letter to One-Letter Conversion
When input documents contain sequences written in full 3-letter strings (e.g. `GluValGln` or `GLU VAL GLN` -> `EVQ`), use this sliding window converter:
```typescript
function convertThreeLetterToOneLetter(seq: string): string {
  const map: { [key: string]: string } = {
    'ALA': 'A', 'ARG': 'R', 'ASN': 'N', 'ASP': 'D', 'CYS': 'C',
    'GLN': 'Q', 'GLU': 'E', 'GLY': 'G', 'HIS': 'H', 'ILE': 'I',
    'LEU': 'L', 'LYS': 'K', 'MET': 'M', 'PHE': 'F', 'PRO': 'P',
    'TRP': 'W', 'TYR': 'Y', 'VAL': 'V', 'SER': 'S', 'THR': 'T'
  };
  const clean = seq.replace(/[\d\s\.\-]/g, '').toUpperCase();
  let result = '';
  for (let i = 0; i <= clean.length - 3; i += 3) {
    const triplet = clean.substring(i, i + 3);
    result += map[triplet] || '?';
  }
  return result.replace(/\?/g, 'X');
}
```

### B. J-Motif and Domain Boundary Truncation
Antibody extraction must filter out the constant regions (e.g. `ASTKGP...` or `RTVAAP...`) and retain ONLY the variable domain (Fv). Truncate when the sequence is $>135$ amino acids based on conserved framework-4 J-motifs:
```typescript
const jMotifs = [
  /VTVSS[A-Z]*/,           // Heavy chain standard
  /VTVSA[A-Z]*/,           // Heavy chain variant
  /VEIK[A-Z]*/,            // Light chain Kappa standard
  /LEIK[A-Z]*/,            // Light chain Kappa variant
  /VFG[A-Z]GTK[A-Z]*/,     // Light chain variant
  /FGGGTK[A-Z]*/           // Light chain alternative
];
```
*If a match index is found $>90$ residues, truncate immediately after the conserved motif. Flag elements that required truncation in the review model.*

### C. OCR Correction (O $\to$ Q Mapping)
Under high optical-character-recognition errors, `O` (Pyrrolysine) is frequently mapped instead of `Q` (Glutamine). Automate mapping replacement:
```typescript
const replaceOWithQ = (s: string) => {
  return s.split('').map(c => c.toUpperCase() === 'O' ? (c === 'o' ? 'q' : 'Q') : c).join('');
};
```

---

## 3. Persistent Firestore Schema
Register the following collections for multi-tenant billing models and guest control:
1. `users`: Stores user logs, associated `role` (`admin` or `guest`), active statuses, and webhook references.
2. `accounts`: Associates parent enterprise tiers to prevent unrated consumption.
3. `results`: Saves curated antibody lists, token metadata, target metrics, and verification states.
4. `activity_logs`: Writes audit lines for every job, download, and login operation.

---

## 4. Prompt Engineering Blueprint (The Golden Curation Prompt)
Below is the system instruction sent to the LLM during the heavy-volume variable-chain mining sequence.

### The System Prompt
```markdown
You are an expert in high-quality antibody sequence mining from patent documents. 
Your goal is 100% Verbatim Accuracy and 100% Coverage.

IMPORTANT EXTRACTION RULES:
1. Antibody Naming: Identify variants and treat separate sequences (e.g., "2419-0105" vs "2419-1204") as independent entities with individual VH/VL chains.
2. Single-Domain / VHH Handling (Nanobodies): consist ONLY of a Heavy (VH) chain. Do not enforce placeholders or generate a mock Light chain.
3. Boundary & Discard Guidelines: Extract VARIABLE DOMAIN (Fv) only. Do not include constant regions (excluding ASTKGP... or RTVAAP...). Truncate sequences immediately inside framework-4 J-motifs.
4. Data Density Optimization: Scrape every row across multi-page tables. If the batch exceeds 30+ clones, fallback to compact key-value listings (IC50 / Kd values) to prevent token exhaustion.
5. Bidirectional Search: For bispecific setups, crawl adjacent tables to tie corresponding heavy/light chains to unified Arm-1 and Arm-2 descriptors.
6. Target Naming Standards: Map species consistently (e.g., "Human" -> "Homo sapiens", "Cyno/Cynomolgus" -> "Macaca fascicularis").
```

### JSON Response Schema Constraint
Always instruct the AI to respond in raw, schema-valid JSON adhering to:
```json
{
  "type": "OBJECT",
  "properties": {
    "patentId": { "type": "STRING" },
    "patentTitle": { "type": "STRING" },
    "antibodies": {
      "type": "ARRAY",
      "items": {
        "type": "OBJECT",
        "properties": {
          "mAbName": { "type": "STRING" },
          "confidence": { "type": "NUMBER" },
          "summary": { "type": "STRING" },
          "epitope": { "type": "STRING" },
          "targetSpecies": { "type": "STRING" },
          "antibodyOrigin": { "type": "STRING" },
          "chains": {
            "type": "ARRAY",
            "items": {
              "type": "OBJECT",
              "properties": {
                "type": { "type": "STRING", "enum": ["Heavy", "Light"] },
                "fullSequence": { "type": "STRING" },
                "seqId": { "type": "STRING" },
                "pageNumber": { "type": "INTEGER" },
                "tableId": { "type": "STRING" },
                "target": { "type": "STRING" },
                "cdrs": {
                  "type": "ARRAY",
                  "items": {
                    "type": "OBJECT",
                    "properties": {
                      "type": { "type": "STRING", "enum": ["CDR1", "CDR2", "CDR3"] },
                      "sequence": { "type": "STRING" },
                      "start": { "type": "INTEGER" },
                      "end": { "type": "INTEGER" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

---

## 5. Re-hydration Prompt
*If you open a fresh chat in Google AI Studio or other software, copy and paste the text block below to instantly bootstrap this exact layout with zero regression:*

```text
Help me spin up "AbMiner" under the Cheminformatic Labs portfolio. 

Requirements:
1. Tech Stack: React (Vite) + Tailwind CSS (v4) + Express server-side handlers inside a single full-stack schema.
2. Style: Adopt a premium slate-dark and white hybrid workspace layout with Inter typography for metadata, Space Grotesk for Display, and JetBrains Mono for sequence alignments.
3. UI Logic: Build forms for inputting Patent ID or uploading PDFs. Implement a dual Single/Batch mining dashboard. Include the "Neural Loading Screen" looping through variable analysis steps with an active timer.
4. Core Curation Rules: Build pre- and post-processors (3-letter conversions, automated J-motif sequence truncations to discard CH1/CL constant regions, and O->Q OCR corrections). Map annotations (CDR1, CDR2, CDR3) accurately on sequences.
5. Authentication & Sync: Integrate Firebase Auth with Role-based constraints ('admin' vs 'guest'). Guest operations restrict token costs and hide high-compute models (showing an "Optimized Extraction" shield).
6. Exports: Full support for PapaParse-powered CSV and custom SQL schema generator files.

Please use the HANDOVER_RECIPE.md and CHEMINFORMATIC_DESIGN_SYSTEM.md files in my directory as your absolute reference guides for code blocks and typography. Let's do it!
```
