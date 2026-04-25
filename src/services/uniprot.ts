
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

  try {
    // We search for human proteins by default (organism_id:9606)
    // We query for the target name which could be a gene symbol or protein name
    const query = encodeURIComponent(`(gene:${targetName} OR name:${targetName}) AND organism_id:9606`);
    const url = `https://rest.uniprot.org/uniprotkb/search?query=${query}&format=json&size=1`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`UniProt API error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.results || data.results.length === 0) {
      // Try a more broad search if the specific one fails
      const broadQuery = encodeURIComponent(`${targetName} AND organism_id:9606`);
      const broadUrl = `https://rest.uniprot.org/uniprotkb/search?query=${broadQuery}&format=json&size=1`;
      const broadResponse = await fetch(broadUrl);
      if (broadResponse.ok) {
        const broadData = await broadResponse.json();
        if (broadData.results && broadData.results.length > 0) {
          return parseUniProtEntry(broadData.results[0]);
        }
      }
      return null;
    }

    return parseUniProtEntry(data.results[0]);
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
