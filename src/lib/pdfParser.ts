import * as pdfjs from 'pdfjs-dist';

// Use a CDN-hosted worker for simplicity in this environment
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

interface PageText {
  page: number;
  text: string;
}

/**
 * Extracts text from a PDF, attempting to preserve spatial layout which helps with table identification.
 */
export async function extractTextFromPdf(base64Data: string): Promise<string> {
  try {
    const binaryString = atob(base64Data.trim());
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const loadingTask = pdfjs.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;
    const pages: PageText[] = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      
      // Attempt to preserve layout by grouping items by their Y coordinate
      const items = textContent.items as any[];
      const lines: Map<number, string[]> = new Map();
      
      items.forEach((item) => {
        const y = Math.round(item.transform[5]); // Y coordinate
        if (!lines.has(y)) {
          lines.set(y, []);
        }
        lines.get(y)!.push(item.str);
      });

      // Sort Y coordinates descending (top to bottom)
      const sortedYs = Array.from(lines.keys()).sort((a, b) => b - a);
      const pageText = sortedYs
        .map((y) => lines.get(y)!.join('    ')) // Join pieces in a line with some space
        .join('\n');

      pages.push({ page: i, text: pageText });
    }

    return pages.map(p => `--- PAGE ${p.page} ---\n${p.text}`).join('\n\n');
  } catch (error) {
    console.error("[PDF Parser] Failed to extract text:", error);
    throw error;
  }
}
