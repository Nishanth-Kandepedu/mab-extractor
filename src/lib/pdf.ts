import { PDFDocument } from 'pdf-lib';

/**
 * Parses a range string like "1-5, 10, 12-15" into a unique array of 0-indexed page numbers.
 */
export function parsePageRange(range: string, totalPages: number): number[] {
  const pages = new Set<number>();
  const parts = range.split(',').map(p => p.trim());

  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(n => parseInt(n.trim(), 10));
      if (!isNaN(start) && !isNaN(end)) {
        const s = Math.max(1, start);
        const e = Math.min(totalPages, end);
        for (let i = s; i <= e; i++) {
          pages.add(i - 1);
        }
      }
    } else {
      const page = parseInt(part, 10);
      if (!isNaN(page) && page >= 1 && page <= totalPages) {
        pages.add(page - 1);
      }
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
}

/**
 * Cuts a PDF base64 string to only include requested pages.
 */
export async function getPdfPages(base64Data: string, range: string): Promise<string> {
  try {
    const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const srcDoc = await PDFDocument.load(bytes);
    const totalPages = srcDoc.getPageCount();
    
    const pageIndices = parsePageRange(range, totalPages);
    if (pageIndices.length === 0) return base64Data;

    const newDoc = await PDFDocument.create();
    const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
    copiedPages.forEach(p => newDoc.addPage(p));
    
    const newBytes = await newDoc.save();
    return btoa(String.fromCharCode(...newBytes));
  } catch (e) {
    console.error("Error splitting PDF:", e);
    return base64Data; // Fallback to original
  }
}

/**
 * Splits a PDF into multiple chunks of given size.
 */
export async function splitPdfIntoChunks(base64Data: string, chunkSize: number = 30): Promise<string[]> {
  try {
    const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const srcDoc = await PDFDocument.load(bytes);
    const totalPages = srcDoc.getPageCount();
    const chunks: string[] = [];

    for (let i = 0; i < totalPages; i += chunkSize) {
      const end = Math.min(i + chunkSize, totalPages);
      const newDoc = await PDFDocument.create();
      
      const indices = [];
      for (let j = i; j < end; j++) indices.push(j);
      
      const copiedPages = await newDoc.copyPages(srcDoc, indices);
      copiedPages.forEach(p => newDoc.addPage(p));
      
      const newBytes = await newDoc.save();
      chunks.push(btoa(String.fromCharCode(...newBytes)));
    }

    return chunks;
  } catch (e) {
    console.error("Error chunking PDF:", e);
    return [base64Data];
  }
}
