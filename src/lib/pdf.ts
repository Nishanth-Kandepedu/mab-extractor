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
    
    const newBytes = await newDoc.save();
    
    // 3. Convert back to base64 safely (avoid String.fromCharCode(...newBytes) stack error)
    let binary = '';
    const len = newBytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(newBytes[i]);
    }
    return btoa(binary);
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

/**
 * Dynamically loads pdf.js from cdnjs in the browser for client-side text extraction.
 */
async function loadPdfJS(): Promise<any> {
  if ((window as any).pdfjsLib) {
    return (window as any).pdfjsLib;
  }
  
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js';
    script.onload = () => {
      const pdfjsLib = (window as any).pdfjsLib;
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
      resolve(pdfjsLib);
    };
    script.onerror = (e) => reject(new Error('Failed to load PDF.js from CDN to extract text on the client. Please check your network connection.'));
    document.head.appendChild(script);
  });
}

/**
 * Extracts raw plain text from a base64 encoded PDF file on the client.
 */
export async function extractTextFromPdfClient(base64Data: string, range?: string): Promise<string> {
  const pdfjsLib = await loadPdfJS();
  
  const binaryString = atob(base64Data.trim());
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  
  // Parse range if provided, otherwise extract all pages
  let pageIndices: number[] = [];
  if (range && /[\d]+/.test(range)) {
    const cleanRange = range.replace(/[^0-9,-]/g, '');
    pageIndices = parsePageRange(cleanRange, totalPages);
  } else {
    for (let i = 0; i < totalPages; i++) {
      pageIndices.push(i);
    }
  }
  
  let fullText = "";
  for (const pageIdx of pageIndices) {
    try {
      const page = await pdf.getPage(pageIdx + 1);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(" ");
      fullText += `[PAGE ${pageIdx + 1}]\n${pageText}\n\n`;
    } catch (err) {
      console.error(`Failed to extract text from page ${pageIdx + 1}:`, err);
    }
  }
  
  return fullText;
}
