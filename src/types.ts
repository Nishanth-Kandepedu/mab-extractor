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

export interface AntibodyProperties {
  targetActivity?: string;
  cellLine?: string;
  admet?: string;
  pk?: string;
  physchem?: string;
  otherProperties?: string;
  evidencePage?: string;
}

export interface Antibody {
  mAbName: string;
  chains: Chain[];
  properties?: AntibodyProperties;
  confidence: number;
  summary: string;
}

export interface UsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

export interface ExtractionResult {
  id?: string;
  userId?: string;
  patentId: string;
  patentTitle: string;
  antibodies: Antibody[];
  createdAt?: string;
  status?: 'pending' | 'validated' | 'rejected';
  usageMetadata?: UsageMetadata;
}

export interface AppState {
  isExtracting: boolean;
  result: ExtractionResult | null;
  error: string | null;
}
