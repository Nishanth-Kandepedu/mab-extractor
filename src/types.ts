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
  targetSpecies?: string;
  sequenceReference?: string;
  targetActivity?: string;
  cellLine?: string;
  admet?: string;
  pk?: string;
  physchem?: string;
  otherProperties?: string;
  evidencePage?: string;
  bindingActivity?: 'Yes' | 'No';
  pkActivity?: 'Yes' | 'No';
  functionalActivity?: 'Yes' | 'No';
  expressionSystem?: 'Yes' | 'No';
}

export interface TargetInfo {
  antigen_name: string | null;
  antigen_aliases: string[] | null;
  species: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
}

export interface SARMutation {
  mutation_position: string | null;
  mutation_type: string | null;
  effect_on_binding: string | null;
  effect_magnitude: string | null;
  evidence: string | null;
}

export interface SARResidue {
  position: string | null;
  residue: string | null;
  importance: string | null;
  evidence: string | null;
}

export interface SARInfo {
  structure_activity_relationships: SARMutation[] | null;
  key_residues: SARResidue[] | null;
}

export interface SPRValue {
  value: number | null;
  unit: string | null;
  method: string | null;
  conditions: string | null;
}

export interface SPRAffinityComparison {
  antibody_name: string | null;
  kd_value: number | null;
  kd_unit: string | null;
  comparison: string | null;
}

export interface SPRInfo {
  kon: SPRValue | null;
  koff: SPRValue | null;
  kd: SPRValue | null;
  affinity_comparisons: SPRAffinityComparison[] | null;
}

export interface ADMEValue {
  value: number | null;
  unit: string | null;
  species: string | null;
  route?: string | null;
  dose?: string | null;
}

export interface ADMEImmunogenicity {
  ada_positive_rate: string | null;
  species: string | null;
  duration: string | null;
  clinical_impact: string | null;
}

export interface ADMEStability {
  formulation: string | null;
  storage_conditions: string | null;
  shelf_life: string | null;
  aggregation_data: string | null;
}

export interface ADMEInfo {
  half_life: ADMEValue | null;
  clearance: ADMEValue | null;
  bioavailability: ADMEValue | null;
  volume_of_distribution: ADMEValue | null;
  immunogenicity: ADMEImmunogenicity | null;
  stability: ADMEStability | null;
}

export interface EpitopeResidue {
  residue_position: string | null;
  interaction_type: string | null;
  evidence_method: string | null;
}

export interface EpitopeCompetition {
  competitor_antibody: string | null;
  blocks_binding: boolean | null;
  evidence: string | null;
}

export interface EpitopeInfo {
  epitope_type: string | null;
  binding_residues: EpitopeResidue[] | null;
  epitope_sequence: string | null;
  competitive_binding: EpitopeCompetition[] | null;
  epitope_bin: string | null;
}

export interface ManufacturingExpression {
  host_cell: string | null;
  cell_line_name: string | null;
  vector_type: string | null;
  promoter: string | null;
}

export interface ManufacturingYield {
  value: number | null;
  unit: string | null;
  culture_duration: string | null;
  culture_conditions: string | null;
}

export interface ManufacturingPurification {
  methods: string[] | null;
  final_purity: string | null;
  endotoxin_level: string | null;
}

export interface ManufacturingFormulation {
  buffer_composition: string | null;
  ph: string | null;
  concentration: string | null;
  excipients: string[] | null;
  preservatives: string[] | null;
}

export interface ManufacturingQuality {
  aggregation_level: string | null;
  charge_variants: string | null;
  glycosylation_profile: string | null;
  potency: string | null;
}

export interface ManufacturingInfo {
  expression_system: ManufacturingExpression | null;
  production_yield: ManufacturingYield | null;
  purification: ManufacturingPurification | null;
  formulation: ManufacturingFormulation | null;
  quality_attributes: ManufacturingQuality | null;
  scalability: {
    largest_scale_tested: string | null;
    yield_consistency: string | null;
  } | null;
}

export interface SourceEvidence {
  target_source: string | null;
  sar_source: string | null;
  spr_source: string | null;
  adme_dmpk_source: string | null;
  epitope_source: string | null;
  manufacturing_source: string | null;
}

export interface Antibody {
  mAbName: string;
  antibody_id?: string | null;
  chains: Chain[];
  confidence: number;
  summary: string;
  
  // New detailed properties
  target?: TargetInfo | null;
  sar?: SARInfo | null;
  spr?: SPRInfo | null;
  adme_dmpk?: ADMEInfo | null;
  epitope?: EpitopeInfo | null;
  manufacturing?: ManufacturingInfo | null;
  source_evidence?: SourceEvidence | null;

  needsReview?: boolean;
  reviewReason?: string;
  evidenceLocation?: string; 
  evidenceStatement?: string; 
  seqId?: string; 
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
