
interface UniProtMetadata {
  standardName: string;
  synonyms: string[];
  geneSymbols: string[];
  uniprotId: string;
}

export async function fetchTargetMetadata(targetName: string): Promise<UniProtMetadata | null> {
  if (!targetName || targetName.toLowerCase() === 'n/a' || targetName.length < 2) {
    return null;
  }

  // Clean the target name: remove "Target: " prefix if present, take first entity
  const cleanTarget = targetName
    .replace(/^target:\s*/i, '')
    .split(',')[0]
    .split('/')[0]
    .trim();

  try {
    // Strategy: Search for the target in human proteins (organism 9606)
    // We prioritize reviewed entries (Swiss-Prot) for better data quality
    const queries = [
      `gene_exact:${cleanTarget} AND organism_id:9606 AND reviewed:true`,
      `protein_name:${cleanTarget} AND organism_id:9606 AND reviewed:true`,
      `name:${cleanTarget} AND organism_id:9606 AND reviewed:true`,
      `${cleanTarget} AND organism_id:9606 AND reviewed:true`,
      `${cleanTarget} AND organism_id:9606` // Fallback to unreviewed if needed
    ];

    for (const q of queries) {
      const query = encodeURIComponent(q);
      const url = `https://rest.uniprot.org/uniprotkb/search?query=${query}&format=json&size=1`;
      
      console.log(`[UniProt] Trying query: ${q}`);
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (data.results && data.results.length > 0) {
          console.log(`[UniProt] Found match for ${cleanTarget} using query: ${q}`);
          return parseUniProtEntry(data.results[0]);
        }
      }
    }

    console.log(`[UniProt] No results found for ${cleanTarget} after all attempts`);
    return null;
  } catch (error) {
    console.error('Error fetching target metadata from UniProt:', error);
    return null;
  }
}

function parseUniProtEntry(entry: any): UniProtMetadata {
  const standardName = entry.proteinDescription?.recommendedName?.fullName?.value || entry.primaryAccession;
  const synonyms: string[] = [];
  
  // Extract alternative names
  if (entry.proteinDescription?.alternativeNames) {
    entry.proteinDescription.alternativeNames.forEach((alt: any) => {
      if (alt.fullName?.value) synonyms.push(alt.fullName.value);
      if (alt.shortNames) alt.shortNames.forEach((s: any) => synonyms.push(s.value));
    });
  }

  // Extract gene symbols
  const geneSymbols: string[] = [];
  if (entry.genes) {
    entry.genes.forEach((g: any) => {
      if (g.geneName?.value) geneSymbols.push(g.geneName.value);
      if (g.synonyms) g.synonyms.forEach((s: any) => geneSymbols.push(s.value));
    });
  }

  return {
    standardName,
    synonyms: Array.from(new Set(synonyms)),
    geneSymbols: Array.from(new Set(geneSymbols)),
    uniprotId: entry.primaryAccession
  };
}
