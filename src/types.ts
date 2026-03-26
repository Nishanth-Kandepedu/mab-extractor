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
  functionalSAR?: string;
  otherProperties?: string;
  evidencePage?: string;
  // New fields for the detailed export
  company?: string;
  country?: string;
  indication?: string;
  moleculeNumber?: string;
  mabType?: string;
  mabSpecies?: string;
  mabFormat?: string;
  targetSpecies?: string;
  sequenceReference?: string;
  bindingActivity?: 'Yes' | 'No';
  pkActivity?: 'Yes' | 'No';
  functionalActivity?: 'Yes' | 'No';
  expressionSystem?: 'Yes' | 'No';
}

export interface Antibody {
  mAbName: string;
  targetName?: string;
  chains: Chain[];
  properties?: AntibodyProperties;
  confidence: number;
  summary: string;
}

export type ExtractionTier = 'fast' | 'balanced' | 'extended';

export interface UsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  modelUsed?: string;
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
  tier?: ExtractionTier;
}

export interface AppState {
  isExtracting: boolean;
  extractionStep?: string;
  result: ExtractionResult | null;
  error: string | null;
  extractionTier: ExtractionTier;
}
