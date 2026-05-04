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
    // 1. Convert base64 to Uint8Array efficiently (avoid heavy memory copying)
    const binaryString = atob(base64Data.trim());
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    const srcDoc = await PDFDocument.load(bytes);
    const totalPages = srcDoc.getPageCount();
    
    // 2. Parse range - be more permissive (extract numbers/ranges)
    // Strip words like "Page", "Section", "Table" etc.
    const cleanRange = range.replace(/[^0-9,-]/g, '');
    const pageIndices = parsePageRange(cleanRange, totalPages);
    
    if (pageIndices.length === 0) {
      console.warn("[PDF] No valid page numbers found in range context:", range);
      return base64Data;
    }

    console.log(`[PDF] Physical Crop: Reducing ${totalPages}pp to ${pageIndices.length}pp (Indices: ${pageIndices})`);

    const newDoc = await PDFDocument.create();
    const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
    copiedPages.forEach(p => newDoc.addPage(p));
    
    // 3. Convert back to base64 safely 
    const newBytes = await newDoc.save();
    return await new Promise<string>((resolve) => {
      const blob = new Blob([newBytes], { type: 'application/pdf' });
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        resolve(base64String.split(',')[1]);
      };
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error("[PDF] Optimization failed, falling back to original file:", e);
    return base64Data; // Fallback to original
  }
}

/**
 * Returns the total page count of a PDF.
 */
export async function getPdfPageCount(base64Data: string): Promise<number> {
  try {
    const binaryString = atob(base64Data.trim());
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return srcDoc.getPageCount();
  } catch (e) {
    console.error("[PDF] Error getting page count:", e);
    return 0;
  }
}
