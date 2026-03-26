export interface CDR {
  sequence: string;
  start: number;
  end: number;
  type: 'CDR1' | 'CDR2' | 'CDR3';
}

export interface Chain {
  type: 'Heavy' | 'Light';
  fullSequence: string;
  cdrs: CDR[];
}

export interface Antibody {
  mAbName: string;
  chains: Chain[];
  confidence: number;
  summary: string;
  reasoning?: string;
  validation?: {
    cdrsMatchFullSequence: boolean;
    chainsPairedCorrectly: boolean;
  };
}

export interface UsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  cost?: number;
}

export interface ExtractionResult {
  id?: string;
  userId?: string;
  patentId: string;
  patentTitle: string;
  isExhaustive: boolean;
  coverageNote: string;
  antibodies: Antibody[];
  createdAt?: string;
  status?: 'pending' | 'validated' | 'rejected';
  usageMetadata?: UsageMetadata;
  extractionTime?: number; // in milliseconds
}

export interface AppState {
  isExtracting: boolean;
  result: ExtractionResult | null;
  error: string | null;
}
