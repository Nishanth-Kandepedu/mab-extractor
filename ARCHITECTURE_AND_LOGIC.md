# AbMiner Architecture & Logic Documentation

This document provides a deep dive into the technical architecture, extraction logic, Accuracy/Coverage strategies, and the division between AI-driven and deterministic (rule-based) processes.

---

## 1. System Architecture Overview

AbMiner follows a **Hybrid Intelligence Architecture** that balances the creative reasoning of Large Language Models (LLMs) with the strict reliability of bioinformatics rules.

### 1.1 Data Flow Diagram (Conceptual)
1.  **Frontend (React)**: Handles PDF/Text ingestion and client-side processing using `pdfjs-dist`.
2.  **Multimodal Pipe**: PDF bytes (or raw text) are streamed directly to the Gemini 3.1 Pro/Flash API.
3.  **Core Extraction Engine (LLM)**: Identifies entities (mAb IDs, sequences, targets) using specialized bio-instructions.
4.  **Deterministic Post-Processing (TypeScript)**: Validates, heals, and truncates sequences based on biological standard motifs.
5.  **Target Enrichment (UniProt)**: Cross-references targets with standard bioinformatics databases.
6.  **Persistence Layer (Firestore)**: Stores validated results with real-time sync for multi-user collaboration.

---

## 2. Extraction Logics & Guardrails

### 2.1 LLM System Instructions (The "Brain")
The system prompt in `src/services/llm.ts` uses several high-level strategies:
*   **Verbatim Mandate**: Explicitly commands 100% character accuracy for sequences.
*   **Table-First Protocol**: Instructs the model to scan structural tables (Table 1, Table 3, Table 6) as the primary source of truth for the complete list of clones.
*   **Anti-Laziness Rule**: Specifically forces the extraction of "parental" clones from early tables, preventing the model from only focusing on the summarized final assemblies.
*   **Fv Domain Specialization**: Instructions to identify the boundary between Variable (Fv) and Constant (CH1/CL) regions.

### 2.2 JSON Healing (The "Safety Net")
To handle potential truncation near the output token limit (approx. 65k tokens), the system uses:
*   **Brace-Stack Tracking**: A logic that counts open/closed brackets and "heals" truncated JSON by closing the stack correctly.
*   **Aggressive Trim**: Trimming to the last valid closing character if standard parsing fails.

### 2.3 Deterministic Guardrails (The "Enforcer")
Once the LLM provides raw data, a battery of TypeScript-based rules "heals" the output:
1.  **Normalization**: Removing spaces, dots, dashes, and numbers from raw sequences.
2.  **3-Letter to 1-Letter Conversion**: Deterministically converts "GluValGln" style sequences to "EVQ".
3.  **OCR Correction**: Automatically corrects common OCR errors like `O -> Q` (Pyrrolysine vs Glutamine) based on biological frequency in mAbs.
4.  **Motif-Based Truncation**:
    *   **VH**: Truncates after `VTVSS` (Framework 4).
    *   **VL**: Truncates after `VEIK`, `VFGXG`, or `FGGGTK` (Framework 4).
    *   This removes constant regions often mistakenly included by the LLM.
5.  **CDR Self-Correction**: The system re-searches the CDR sequences provided by the LLM within the Full Sequence. If a visual mismatch is found (indices don't align), it flags the mAb for review and disables highlighting to prevent false positives.
6.  **Anomaly Detection**: Flags sequences with non-standard amino acids or suspicious lengths (e.g., VH > 140 AA).

---

## 3. Coverage & Accuracy Strategies

### 3.1 100% Coverage Strategy: "Discovery Pass"
For large documents (Deep Scan Mode), the system uses a two-pass approach:
1.  **Pass 1 (Discovery)**: A lightweight pass that scans the entire document to identify "hot pages" containing sequences, tables, or SEQ ID lists.
2.  **Pass 2 (Targeted)**: Only the high-density clusters are processed with the full reasoning model, ensuring high focus and avoiding token saturation.

### 3.2 Metadata Logic
*   **Target Identification**: Distinguishes between the antigen (e.g., HER2) and the recruiter (e.g., CD3).
*   **Standardization**: Automatically normalizes target species (e.g., "Cyno" -> "Macaca fascicularis") using a predefined mapping.
*   **UniProt Integration**: Queries human protein databases for gene symbols and accession numbers. For bispecifics, it uses a custom priority logic to identify the "payload" arm vs. the "linkage" arm.

---

## 4. LLM vs. Non-LLM Task Division

| Task | Method | Why? |
| :--- | :--- | :--- |
| **PDF Text Extraction** | Non-LLM (`pdfjs-dist`) | High speed, predictable layout preservation. |
| **Entity Recognition** | LLM (Gemini) | Requires semantic understanding of patent context. |
| **Logic Reasoning** | LLM (Gemini) | Connecting chains split across different tables. |
| **Sequence Cleaning** | Non-LLM (Regex) | 100% predictable, no hallucination risk. |
| **J-Motif Truncation** | Non-LLM (Motif Search) | Reliable biological standard enforcement. |
| **Target Mapping** | Hybrid (LLM + UniProt) | LLM finds the name; UniProt validates with the database. |
| **Security/RBAC** | Non-LLM (Firestore Rules) | Critical security must be programmatic, not AI-driven. |

---

## 5. Metadata Logic & Experimental Coverage

The system handles experimental data (SAR data) by categorizing it into 6 strict domains:
1.  **In Vitro**: Binding affinity, IC50, EC50.
2.  **PK**: Half-life, Clearance, Cmax.
3.  **ADMET**: Solubility, Serum stability.
4.  **In Vivo**: Tumor Growth Inhibition (TGI).
5.  **Physical**: Melting temperature (Tm), pI.
6.  **Other**: Specific pharmaceutical properties.

Entries include exact values, units, conditions (e.g., "in human PD-L1 ELISA"), and the specific evidence location (page/table).
