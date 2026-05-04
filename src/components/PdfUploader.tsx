import React, { useState } from 'react';
import { Upload, FileText, X, AlertCircle, Loader2 } from 'lucide-react';
import { extractTextFromPdf } from '../lib/pdfParser';

interface PdfUploaderProps {
  onFileReady: (file: File, extractedText?: string) => void;
  isLoading?: boolean;
}

export const PdfUploader: React.FC<PdfUploaderProps> = ({ onFileReady, isLoading }) => {
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    if (file.type === 'application/pdf') {
      setIsParsing(true);
      setError(null);
      try {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const base64 = (event.target?.result as string).split(',')[1];
          try {
            const text = await extractTextFromPdf(base64);
            onFileReady(file, text);
          } catch (err) {
            console.error("PDF Parsing failed, falling back to raw file:", err);
            onFileReady(file);
          } finally {
            setIsParsing(false);
          }
        };
        reader.onerror = () => {
          setError("Failed to read file.");
          setIsParsing(false);
        };
        reader.readAsDataURL(file);
      } catch (err) {
        setError("Error initializing parser.");
        setIsParsing(false);
      }
    } else {
      onFileReady(file);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="w-full">
      <label 
        className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-zinc-200 rounded-[24px] cursor-pointer hover:bg-zinc-50 transition-all duration-300 group"
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center justify-center pt-5 pb-6">
          {isParsing || isLoading ? (
            <div className="relative">
              <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-2 h-2 bg-indigo-600 rounded-full animate-pulse" />
              </div>
            </div>
          ) : (
            <div className="p-4 bg-zinc-100 rounded-2xl group-hover:bg-indigo-50 transition-colors duration-300">
              <Upload className="w-8 h-8 text-zinc-500 group-hover:text-indigo-600 transition-colors duration-300" />
            </div>
          )}
          <p className="mt-4 text-sm font-bold text-zinc-900">
            {isParsing ? "Digitizing PDF Tables..." : "Drop Patent PDF or TXT"}
          </p>
          <p className="text-[10px] text-zinc-400 mt-1.5 uppercase font-bold tracking-widest">
            {isParsing ? "Preserving spatial layout..." : "Maximum character accuracy"}
          </p>
        </div>
        <input 
          type="file" 
          className="hidden" 
          accept=".pdf,.txt" 
          onChange={handleFileChange}
          disabled={isParsing || isLoading}
        />
      </label>
      
      {error && (
        <div className="mt-4 p-3 bg-red-50 rounded-xl flex items-center gap-2 text-red-700 text-sm animate-in fade-in slide-in-from-top-1">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}
    </div>
  );
};
