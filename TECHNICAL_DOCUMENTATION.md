# Technical Documentation & Architecture Guide

## 1. Project Overview
The **AbMiner** is a high-quality, AI-powered platform designed to automate the mining of antibody sequences from complex patent documents (PDFs or raw text). It achieves near-perfect amino acid accuracy by combining advanced LLM reasoning with a robust validation and "healing" architecture.

---

## 2. System Architecture

### 2.1 High-Level Data Flow
1.  **Ingestion**: User uploads a PDF or pastes text into the React frontend.
2.  **Parsing**: The `pdfjs-dist` library parses the PDF directly in the browser, extracting raw text and preserving table structures where possible.
3.  **Extraction**: The text is sent to the **Gemini 3.1 Pro** model via the `@google/genai` SDK.
4.  **Reasoning**: The AI uses a specialized **Bioinformatics System Instruction** to identify mAb IDs, Heavy/Light chains, and CDR regions.
5.  **Validation & Healing**: The response is processed by a custom **JSON Repairer** to handle truncation and then validated against biological sequence standards.
6.  **Persistence**: Results are stored in **Firebase Firestore** with real-time synchronization.
7.  **Export**: Validated data is exported as **FASTA** or **CSV** formats.

### 2.2 Technical Stack
*   **Frontend**: React 18, Vite, Tailwind CSS, Framer Motion, Lucide React.
*   **Backend**: Node.js, Express.js (running on Google Cloud Run).
*   **Database**: Firebase Firestore (NoSQL).
*   **Authentication**: Firebase Auth (Google OAuth).
*   **AI Engine**: Google Gemini 3.1 Pro / Flash (Optimized for High-Quality Mining).
*   **Utilities**: `pdfjs-dist` (PDF parsing), `papaparse` (CSV generation).

---

## 3. AI & LLM Strategy

### 3.1 Prompt Engineering (System Instruction)
The core intelligence resides in the `SYSTEM_INSTRUCTION` located in `src/services/llm.ts`. Key strategies include:
*   **Verbatim Mandate**: Explicitly commands 100% character accuracy.
*   **ID-Mapping**: Forces the AI to list all mAb IDs before extraction to ensure 100% coverage.
*   **Chain-by-Chain Verification**: Instructs the model to "internally re-read" sequences for self-correction.
*   **Source Priority**: Prioritizes "Sequence Listings" over table text for higher fidelity.

### 3.2 JSON "Healing" Architecture
To mitigate the risk of AI truncation (hitting the 65k token limit), the application uses a multi-layered parsing strategy:
1.  **Direct JSON Parsing**: Standard `JSON.parse()`.
2.  **Markdown Extraction**: Regex-based extraction of JSON blocks.
3.  **Brace-to-Brace Extraction**: Finding the first `{` and last `}`.
4.  **Intelligent Repair**: A custom function that calculates missing closing braces/brackets and "heals" the JSON structure to recover as much data as possible.

---

## 4. Database & Security Model

### 4.1 Data Schema (Firestore)
*   **`users/{uid}`**: Stores user profiles and roles (`admin`, `user`, `guest`).
*   **`extractions/{id}`**: Stores the full `ExtractionResult` JSON, including patent metadata and antibody arrays.
*   **`activity_logs/{id}`**: Audit trail for all extractions and downloads.

### 4.2 Security Rules (RBAC)
The application uses **Role-Based Access Control** enforced at the database level:
*   **Standard Users**: Can only read/write their own extractions.
*   **Admins**: Have global read access and can "Validate" or "Reject" any extraction.
*   **Integrity**: Rules prevent users from modifying their own roles or tampering with `authorUid` fields.

---

## 5. Key Components & Services

### 5.1 LLM Service (`src/services/llm.ts`)
The primary interface for AI interactions. It handles model selection, prompt construction, and the JSON repair logic.

### 5.2 PDF Parser (`src/components/PdfUploader.tsx`)
Uses `pdfjs-dist` to convert multi-page PDFs into a single text stream while attempting to preserve the spatial layout of tables.

### 5.3 Sequence Display (`src/components/SequenceDisplay.tsx`)
A specialized UI component that renders amino acid sequences with highlighted CDR regions (CDR1, CDR2, CDR3) for easy manual verification.

---

## 6. Performance & Optimization
*   **Client-Side Processing**: By parsing PDFs and calling the AI from the browser, the application minimizes server costs and maximizes privacy.
*   **Token Management**: The app uses `Gemini 3.1 Flash` for smaller documents to save costs, while defaulting to `Gemini 3.1 Pro` for complex, high-quality mining tasks.
*   **Real-time Sync**: Uses Firestore `onSnapshot` to ensure the Admin Dashboard is always up-to-date without page refreshes.

---

## 7. Deployment
The application is containerized and deployed to **Google Cloud Run**.
*   **Build**: `npm run build` generates a production-ready SPA in the `dist/` folder.
*   **Start**: The Express server serves the `dist/` folder and handles API routing.
*   **Environment Variables**: `GEMINI_API_KEY` and Firebase configurations are managed via the platform's secret manager.
