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

export type ExtractionTier = 'fast' | 'balanced' | 'extended';

export interface AntibodyProperties {
  company?: string;
  country?: string;
  indication?: string;
  moleculeNumber?: string;
  mabType?: string;
  mabSpecies?: string;
  mabFormat?: string;
  targetSpecies?: string;
  sequenceReference?: string;
  targetActivity?: string;
  cellLine?: string;
  admet?: string;
  pk?: string;
  physchem?: string;
  functionalSAR?: string;
  otherProperties?: string;
  evidencePage?: string;
  bindingActivity?: 'Yes' | 'No';
  pkActivity?: 'Yes' | 'No';
  functionalActivity?: 'Yes' | 'No';
  expressionSystem?: 'Yes' | 'No';
}

export interface Antibody {
  mAbName: string;
  chains: Chain[];
  confidence: number;
  summary: string;
  properties?: AntibodyProperties;
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
  antibodies: Antibody[];
  createdAt?: string;
  status?: 'pending' | 'validated' | 'rejected';
  usageMetadata?: UsageMetadata;
  extractionTime?: number; // in milliseconds
  tier?: ExtractionTier;
}

export interface AppState {
  isExtracting: boolean;
  result: ExtractionResult | null;
  error: string | null;
}
