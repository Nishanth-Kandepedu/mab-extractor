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

  // 1. Create Tables Structure (IF NOT EXISTS is key here)
  sql += `-- Table: patents\n`;
  sql += `CREATE TABLE IF NOT EXISTS patents (\n`;
  sql += `  patent_id VARCHAR(50) PRIMARY KEY,\n`;
  sql += `  title TEXT\n`;
  sql += `);\n\n`;

  sql += `-- Table: targets\n`;
  sql += `CREATE TABLE IF NOT EXISTS targets (\n`;
  sql += `  target_id SERIAL PRIMARY KEY,\n`;
  sql += `  name VARCHAR(255) UNIQUE,\n`;
  sql += `  standard_name TEXT,\n`;
  sql += `  uniprot_id VARCHAR(50),\n`;
  sql += `  gene_symbols TEXT,\n`;
  sql += `  synonyms TEXT\n`;
  sql += `);\n\n`;

  sql += `-- Table: sequences\n`;
  sql += `CREATE TABLE IF NOT EXISTS sequences (\n`;
  sql += `  seq_id SERIAL PRIMARY KEY,\n`;
  sql += `  chain_type VARCHAR(20),\n`;
  sql += `  full_sequence TEXT,\n`;
  sql += `  cdr1 TEXT,\n`;
  sql += `  cdr2 TEXT,\n`;
  sql += `  cdr3 TEXT,\n`;
  sql += `  length INTEGER,\n`;
  sql += `  patent_seq_id VARCHAR(100)\n`;
  sql += `);\n\n`;

  sql += `-- Table: antibodies\n`;
  sql += `CREATE TABLE IF NOT EXISTS antibodies (\n`;
  sql += `  mab_id SERIAL PRIMARY KEY,\n`;
  sql += `  mab_name VARCHAR(255),\n`;
  sql += `  patent_id VARCHAR(50) REFERENCES patents(patent_id),\n`;
  sql += `  primary_target_id INTEGER REFERENCES targets(target_id),\n`;
  sql += `  vh_seq_id INTEGER REFERENCES sequences(seq_id),\n`;
  sql += `  vl_seq_id INTEGER REFERENCES sequences(seq_id),\n`;
  sql += `  target_species TEXT,\n`;
  sql += `  origin TEXT,\n`;
  sql += `  epitope TEXT,\n`;
  sql += `  confidence INTEGER,\n`;
  sql += `  needs_review BOOLEAN,\n`;
  sql += `  review_remarks TEXT,\n`;
  sql += `  evidence_location TEXT,\n`;
  sql += `  evidence_statement TEXT,\n`;
  sql += `  summary TEXT\n`;
  sql += `);\n\n`;

  // Process each result
  for (const result of results) {
    sql += `-- START DATA FOR PATENT: ${result.patentId}\n`;
    
    // 2. Insert Patent
    sql += `INSERT INTO patents (patent_id, title) \n`;
    sql += `VALUES (${escapeSql(result.patentId)}, ${escapeSql(result.patentTitle)}) \n`;
    sql += `ON CONFLICT (patent_id) DO UPDATE SET title = EXCLUDED.title;\n\n`;

    // 3. Process Unique Targets for this result
    const uniqueTargets = new Map<string, TargetMetadata | undefined>();
    
    result.antibodies.forEach(mAb => {
      mAb.chains.forEach(chain => {
        if (chain.target) {
          const t = chain.target.toLowerCase().trim();
          if (!uniqueTargets.has(t)) {
            uniqueTargets.set(t, chain.targetMetadata);
          }
        }
      });
    });

    uniqueTargets.forEach((meta, name) => {
      sql += `DO $$\n`;
      sql += `BEGIN\n`;
      sql += `    INSERT INTO targets (name, standard_name, uniprot_id, gene_symbols, synonyms)\n`;
      sql += `    VALUES (\n`;
      sql += `      ${escapeSql(name)}, \n`;
      sql += `      ${escapeSql(meta?.standardName)}, \n`;
      sql += `      ${escapeSql(meta?.uniprotId)}, \n`;
      sql += `      ${escapeSql(meta?.geneSymbols.join(', '))}, \n`;
      sql += `      ${escapeSql(meta?.synonyms.join(', '))}\n`;
      sql += `    )\n`;
      sql += `    ON CONFLICT (name) DO UPDATE SET \n`;
      sql += `      standard_name = COALESCE(targets.standard_name, EXCLUDED.standard_name),\n`;
      sql += `      uniprot_id = COALESCE(targets.uniprot_id, EXCLUDED.uniprot_id);\n`;
      sql += `END $$;\n\n`;
    });

    // 4. Process Antibodies and Sequences
    result.antibodies.forEach((mAb) => {
      sql += `-- Antibody: ${mAb.mAbName}\n`;
      
      const vhChain = mAb.chains.find(c => c.type === 'Heavy');
      const vlChain = mAb.chains.find(c => c.type === 'Light');

      const insertSequence = (chain: Chain | undefined, varName: string) => {
        if (!chain) return ``;
        
        const cdr1 = chain.cdrs.find(c => c.type === 'CDR1')?.sequence || '';
        const cdr2 = chain.cdrs.find(c => c.type === 'CDR2')?.sequence || '';
        const cdr3 = chain.cdrs.find(c => c.type === 'CDR3')?.sequence || '';
        
        return `
        WITH inserted_seq AS (
          INSERT INTO sequences (chain_type, full_sequence, cdr1, cdr2, cdr3, length, patent_seq_id)
          VALUES (
            ${escapeSql(chain.type)}, 
            ${escapeSql(chain.fullSequence)}, 
            ${escapeSql(cdr1)}, 
            ${escapeSql(cdr2)}, 
            ${escapeSql(cdr3)}, 
            ${chain.fullSequence.length}, 
            ${escapeSql(chain.seqId)}
          )
          RETURNING seq_id
        )
        SELECT seq_id INTO ${varName} FROM inserted_seq;
        `;
      };

      sql += `DO $$\n`;
      sql += `DECLARE\n`;
      sql += `  v_vh_id INTEGER := NULL;\n`;
      sql += `  v_vl_id INTEGER := NULL;\n`;
      sql += `  v_target_id INTEGER := NULL;\n`;
      sql += `BEGIN\n`;
      
      const primaryTargetName = (vhChain?.target || vlChain?.target || '').toLowerCase().trim();
      if (primaryTargetName) {
        sql += `    SELECT target_id INTO v_target_id FROM targets WHERE name = ${escapeSql(primaryTargetName)};\n`;
      }

      if (vhChain) sql += insertSequence(vhChain, 'v_vh_id');
      if (vlChain) sql += insertSequence(vlChain, 'v_vl_id');

      sql += `
      INSERT INTO antibodies (
        mab_name, patent_id, primary_target_id, vh_seq_id, vl_seq_id, 
        target_species, origin, epitope, confidence, needs_review, 
        review_remarks, evidence_location, evidence_statement, summary
      ) VALUES (
        ${escapeSql(mAb.mAbName)},
        ${escapeSql(result.patentId)},
        v_target_id,
        v_vh_id,
        v_vl_id,
        ${escapeSql(mAb.targetSpecies)},
        ${escapeSql(mAb.antibodyOrigin)},
        ${escapeSql(mAb.epitope)},
        ${mAb.confidence},
        ${mAb.needsReview ? 'TRUE' : 'FALSE'},
        ${escapeSql(mAb.reviewReason)},
        ${escapeSql(mAb.evidenceLocation)},
        ${escapeSql(mAb.evidenceStatement)},
        ${escapeSql(mAb.summary)}
      );\n`;

      sql += `END $$;\n\n`;
    });
    
    sql += `-- END DATA FOR PATENT: ${result.patentId}\n\n`;
  }

  sql += `COMMIT;\n`;

  return sql;
}
