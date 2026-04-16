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
  seqId?: string;
  pageNumber?: number;
  tableId?: string;
  hasNonStandardAminoAcids?: boolean;
  nonStandardAminoAcids?: string[];
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
  targets?: string;
  targetSpecies?: string;
  sequenceReference?: string;
  bioactivities?: string;
  targetActivity?: string;
  cellLine?: string;
  biologicalSources?: string;
  admet?: string;
  pk?: string;
  physchem?: string;
  epitopeMapping?: string;
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
  needsReview?: boolean;
  reviewReason?: string;
  evidenceLocation?: string; // e.g., "Page 42", "Table 12"
  evidenceStatement?: string; // e.g., "Sequence found in Table 5 on page 12, corresponding to SEQ ID NO: 45"
  seqId?: string; // Overall SEQ ID if applicable
  pageNumber?: number;
  tableId?: string;
}

export interface UsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  thinkingTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount: number;
  cost?: number;
}

export interface Account {
  id: string;
  role: 'admin' | 'guest';
  disabled?: boolean;
  lastActive?: any;
  lastUid?: string;
}

export interface UserProfile {
  uid: string;
  accountId?: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: 'admin' | 'guest' | 'user';
  isAnonymous?: boolean;
  createdAt?: any;
  disabled?: boolean;
  lastActive?: any;
}

export interface ActivityLog {
  id?: string;
  userId: string;
  accountId?: string;
  userDisplayName: string;
  action: 'extraction_started' | 'extraction_completed' | 'download_csv' | 'login' | 'logout' | 'user_disabled' | 'user_enabled' | 'account_disabled' | 'account_enabled';
  patentId?: string;
  patentTitle?: string;
  timestamp: any;
  metadata?: any;
}

export interface ExtractionResult {
  id?: string;
  userId?: string;
  accountId?: string;
  patentId: string;
  patentTitle: string;
  antibodies: Antibody[];
  createdAt?: string;
  status?: 'pending' | 'validated' | 'rejected';
  usageMetadata?: UsageMetadata;
  extractionTime?: number; // in milliseconds
  tier?: ExtractionTier;
  modelUsed?: string;
}

export interface AppState {
  isExtracting: boolean;
  result: ExtractionResult | null;
  error: string | null;
}
