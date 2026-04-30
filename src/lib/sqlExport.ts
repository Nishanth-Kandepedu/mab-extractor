import { ExtractionResult, Antibody, Chain, TargetMetadata } from '../types';

/**
 * Utility to escape SQL strings
 */
function escapeSql(str: string | null | undefined): string {
  if (str === null || str === undefined) return 'NULL';
  return `'${str.replace(/'/g, "''")}'`;
}

/**
 * Generates a SQL dump from one or more extraction results
 * Designed for PostgreSQL / DBeaver import compatibility
 */
export function generateSqlDump(input: ExtractionResult | ExtractionResult[]): string {
  const results = Array.isArray(input) ? input : [input];
  
  if (results.length === 0) return '-- No data to export';

  let sql = `-- ABMiner SQL Dump\n`;
  sql += `-- Generated: ${new Date().toISOString()}\n`;
  sql += `-- Items: ${results.length}\n\n`;

  sql += `BEGIN;\n\n`;

  // 1. Create Tables Structure
  sql += `-- Table Definitions ...\n`;
  sql += `CREATE TABLE IF NOT EXISTS patents (\n  patent_id VARCHAR(50) PRIMARY KEY,\n  title TEXT\n);\n\n`;
  sql += `CREATE TABLE IF NOT EXISTS targets (\n  target_id SERIAL PRIMARY KEY,\n  name VARCHAR(255) UNIQUE,\n  standard_name TEXT,\n  uniprot_id VARCHAR(50),\n  gene_symbols TEXT,\n  synonyms TEXT\n);\n\n`;
  sql += `CREATE TABLE IF NOT EXISTS sequences (\n  seq_id SERIAL PRIMARY KEY,\n  chain_type VARCHAR(20),\n  full_sequence TEXT,\n  cdr1 TEXT,\n  cdr2 TEXT,\n  cdr3 TEXT,\n  length INTEGER,\n  patent_seq_id VARCHAR(100)\n);\n\n`;
  sql += `CREATE TABLE IF NOT EXISTS antibodies (\n  mab_id SERIAL PRIMARY KEY,\n  mab_name VARCHAR(255),\n  patent_id VARCHAR(50) REFERENCES patents(patent_id),\n  primary_target_id INTEGER REFERENCES targets(target_id),\n  vh_seq_id INTEGER REFERENCES sequences(seq_id),\n  vl_seq_id INTEGER REFERENCES sequences(seq_id),\n  target_species TEXT,\n  origin TEXT,\n  epitope TEXT,\n  confidence INTEGER,\n  needs_review BOOLEAN,\n  review_remarks TEXT,\n  evidence_location TEXT,\n  evidence_statement TEXT,\n  summary TEXT\n);\n\n`;

  // 1.5 Pre-calculate All Unique Targets across all patents for global deduplication
  const globalTargets = new Map<string, TargetMetadata | undefined>();
  results.forEach(res => {
    res.antibodies.forEach(mAb => {
      mAb.chains.forEach(chain => {
        if (chain.target) {
          const t = chain.target.toLowerCase().trim();
          const existing = globalTargets.get(t);
          // Prefer metadata that has uniprot or standard name
          if (!existing || (!existing.uniprotId && chain.targetMetadata?.uniprotId)) {
            globalTargets.set(t, chain.targetMetadata);
          }
        }
      });
    });
  });

  sql += `-- GLOBAL TARGETS PRE-SEEDING\n`;
  globalTargets.forEach((meta, name) => {
    sql += `DO $$\nBEGIN\n`;
    sql += `    INSERT INTO targets (name, standard_name, uniprot_id, gene_symbols, synonyms)\n`;
    sql += `    VALUES (${escapeSql(name)}, ${escapeSql(meta?.standardName)}, ${escapeSql(meta?.uniprotId)}, ${escapeSql(meta?.geneSymbols.join(', '))}, ${escapeSql(meta?.synonyms.join(', '))})\n`;
    sql += `    ON CONFLICT (name) DO UPDATE SET \n`;
    sql += `      standard_name = COALESCE(targets.standard_name, EXCLUDED.standard_name),\n`;
    sql += `      uniprot_id = COALESCE(targets.uniprot_id, EXCLUDED.uniprot_id),\n`;
    sql += `      gene_symbols = COALESCE(targets.gene_symbols, EXCLUDED.gene_symbols),\n`;
    sql += `      synonyms = COALESCE(targets.synonyms, EXCLUDED.synonyms);\n`;
    sql += `END $$;\n\n`;
  });

  // Process each result
  for (const result of results) {
    sql += `-- START PATENT: ${result.patentId}\n`;
    
    // 2. Insert Patent
    sql += `INSERT INTO patents (patent_id, title) \n`;
    sql += `VALUES (${escapeSql(result.patentId)}, ${escapeSql(result.patentTitle)}) \n`;
    sql += `ON CONFLICT (patent_id) DO UPDATE SET title = EXCLUDED.title;\n\n`;

    // 4. Process Antibodies and Sequences
    result.antibodies.forEach((mAb) => {
      const vhChain = mAb.chains.find(c => c.type === 'Heavy');
      const vlChain = mAb.chains.find(c => c.type === 'Light');

      const insertSequence = (chain: Chain, varName: string) => {
        const cdr1 = chain.cdrs.find(c => c.type === 'CDR1')?.sequence || '';
        const cdr2 = chain.cdrs.find(c => c.type === 'CDR2')?.sequence || '';
        const cdr3 = chain.cdrs.find(c => c.type === 'CDR3')?.sequence || '';
        
        return `
        WITH inserted_seq AS (
          INSERT INTO sequences (chain_type, full_sequence, cdr1, cdr2, cdr3, length, patent_seq_id)
          VALUES (${escapeSql(chain.type)}, ${escapeSql(chain.fullSequence)}, ${escapeSql(cdr1)}, ${escapeSql(cdr2)}, ${escapeSql(cdr3)}, ${chain.fullSequence.length}, ${escapeSql(chain.seqId)})
          RETURNING seq_id
        ) SELECT seq_id INTO ${varName} FROM inserted_seq;`;
      };

      sql += `DO $$\nDECLARE\n  v_vh_id INTEGER := NULL;\n  v_vl_id INTEGER := NULL;\n  v_target_id INTEGER := NULL;\nBEGIN\n`;
      
      const primaryTargetName = (vhChain?.target || vlChain?.target || '').toLowerCase().trim();
      if (primaryTargetName) {
        sql += `    SELECT target_id INTO v_target_id FROM targets WHERE name = ${escapeSql(primaryTargetName)};\n`;
      }

      if (vhChain) sql += insertSequence(vhChain, 'v_vh_id');
      if (vlChain) sql += insertSequence(vlChain, 'v_vl_id');

      sql += `    INSERT INTO antibodies (mab_name, patent_id, primary_target_id, vh_seq_id, vl_seq_id, target_species, origin, epitope, confidence, needs_review, review_remarks, evidence_location, evidence_statement, summary)\n`;
      sql += `    VALUES (${escapeSql(mAb.mAbName)}, ${escapeSql(result.patentId)}, v_target_id, v_vh_id, v_vl_id, ${escapeSql(mAb.targetSpecies)}, ${escapeSql(mAb.antibodyOrigin)}, ${escapeSql(mAb.epitope)}, ${mAb.confidence}, ${mAb.needsReview ? 'TRUE' : 'FALSE'}, ${escapeSql(mAb.reviewReason)}, ${escapeSql(mAb.evidenceLocation)}, ${escapeSql(mAb.evidenceStatement)}, ${escapeSql(mAb.summary)});\n`;
      sql += `END $$;\n\n`;
    });
  }

  sql += `COMMIT;\n`;
  return sql;
}
