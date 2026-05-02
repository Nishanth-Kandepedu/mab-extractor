import React from 'react';
import { Chain, CDR } from '../types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Copy, Check, Edit2, X, Save, AlertCircle } from 'lucide-react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SequenceDisplayProps {
  chain: Chain;
  isEditable?: boolean;
  onUpdate?: (newSequence: string) => void;
}

export const SequenceDisplay: React.FC<SequenceDisplayProps> = ({ chain, isEditable, onUpdate }) => {
  const { fullSequence, cdrs, type, seqId, pageNumber, tableId, hasNonStandardAminoAcids, target } = chain;
  const [isEditing, setIsEditing] = React.useState(false);
  const [tempSequence, setTempSequence] = React.useState(fullSequence);
  const [copied, setCopied] = React.useState(false);

  const STANDARD_AMINO_ACIDS = new Set("ACDEFGHIKLMNPQRSTVWY");

  // Sync tempSequence if fullSequence changes externally
  React.useEffect(() => {
    setTempSequence(fullSequence);
  }, [fullSequence]);

  const handleSave = () => {
    if (onUpdate) {
      onUpdate(tempSequence);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setTempSequence(fullSequence);
    setIsEditing(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(fullSequence);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Sort CDRs by start position
  const sortedCdrs = [...cdrs].sort((a, b) => a.start - b.start);

  const renderSequence = () => {
    const parts: React.ReactNode[] = [];
    
    for (let i = 0; i < fullSequence.length; i++) {
      const char = fullSequence[i];
      const isNonStandard = !STANDARD_AMINO_ACIDS.has(char.toUpperCase());
      
      // Check if this index is part of a CDR
      const cdr = sortedCdrs.find(c => c.start !== -1 && i >= c.start && i < c.end);
      
      // Verify correctness: Does the sequence at these indices match the claimed CDR sequence?
      const fullCdrSeqAtPos = cdr && fullSequence.substring(cdr.start, cdr.end);
      const isMismatch = cdr && fullCdrSeqAtPos !== cdr.sequence;
      
      const cdrColor = cdr ? (
        isMismatch ? 'bg-rose-50 text-rose-700 border-rose-200' :
        cdr.type === 'CDR1' ? 'bg-indigo-50/80 text-indigo-700 border-indigo-100/50' :
        cdr.type === 'CDR2' ? 'bg-emerald-50/80 text-emerald-700 border-emerald-100/50' :
        'bg-amber-50/80 text-amber-700 border-amber-100/50'
      ) : '';

      parts.push(
        <span 
          key={i} 
          className={cn(
            "inline-block transition-all",
            isNonStandard && "bg-red-500 text-white font-bold px-0.5 rounded",
            cdr && !isNonStandard && cn("px-0.5 rounded border-b-2 font-bold relative group cursor-default", cdrColor),
            !cdr && !isNonStandard && "text-zinc-300"
          )}
        >
          {char}
          {cdr && i === cdr.start && (
            <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-white text-zinc-900 text-[10px] p-3 rounded-xl border border-zinc-100 opacity-0 group-hover:opacity-100 transition-all scale-95 group-hover:scale-100 shadow-[0_8px_24px_rgba(0,0,0,0.1)] z-50 pointer-events-none min-w-[120px]">
              <div className="flex flex-col gap-1">
                <span className="font-extrabold flex items-center gap-2 uppercase tracking-widest text-[9px]">
                  <div className={cn("w-1.5 h-1.5 rounded-full", 
                    cdr.type === 'CDR1' ? 'bg-indigo-500' : 
                    cdr.type === 'CDR2' ? 'bg-emerald-500' : 
                    'bg-amber-500'
                  )} />
                  {cdr.type}
                  {isMismatch && <span className="text-rose-500 font-extrabold italic">! POSITION ERROR</span>}
                </span>
                <div className="h-px bg-zinc-50 my-1" />
                <span className="text-zinc-500 font-mono text-[9px] break-all leading-relaxed">Seq: <span className="text-zinc-900 font-bold">{cdr.sequence}</span></span>
              </div>
            </div>
          )}
        </span>
      );
    }

    return parts;
  };

  return (
    <div className="bg-white border border-zinc-100 rounded-[24px] overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <div className="bg-[#fcfcfd] border-b border-zinc-100 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={cn(
            "w-3 h-3 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.05)]",
            type === 'Heavy' ? "bg-indigo-600" : "bg-emerald-600"
          )} />
          <div className="flex flex-col">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 leading-none">
              {type} chain domain
            </h3>
            <div className="flex items-center gap-2 mt-1.5">
              {seqId && (
                <span className="text-[10px] font-mono bg-zinc-900 text-white px-2 py-0.5 rounded-md font-bold shadow-md">
                  {seqId}
                </span>
              )}
              {target && (
                <span className="text-[10px] font-bold bg-amber-50 text-amber-700 px-2.5 py-0.5 rounded-full border border-amber-100 uppercase tracking-tight">
                  Target: {target}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasNonStandardAminoAcids && (
            <span className="text-[9px] font-bold text-red-600 uppercase tracking-widest bg-red-50 px-2 py-1 rounded-lg border border-red-100">
              Variant AA Detected
            </span>
          )}
          <div className="flex bg-white border border-zinc-100 p-0.5 rounded-xl">
             <button 
               onClick={handleCopy}
               className="p-1.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
               title="Copy Sequence"
             >
               {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
             </button>
             {isEditable && !isEditing && (
               <button 
                 onClick={() => setIsEditing(true)}
                 className="p-1.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                 title="Edit Sequence"
               >
                 <Edit2 className="w-3.5 h-3.5" />
               </button>
             )}
          </div>
          <span className="text-[10px] font-mono font-bold text-zinc-900 bg-zinc-50 border border-zinc-200 px-3 py-1 rounded-lg tabular-nums">
            {fullSequence.length} RESIDUES
          </span>
        </div>
      </div>
      
      <div className="p-4">
        {isEditing ? (
          <div className="space-y-3">
            <textarea
              value={tempSequence}
              onChange={(e) => setTempSequence(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
              className="w-full h-32 bg-zinc-50 border border-zinc-200 rounded-lg p-4 text-sm font-mono focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none"
              placeholder="Edit amino acid sequence..."
            />
            <div className="flex justify-end gap-2">
              <button 
                onClick={handleCancel}
                className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-700"
              >
                <X className="w-3 h-3" />
                Cancel
              </button>
              <button 
                onClick={handleSave}
                className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider rounded hover:bg-indigo-700 transition-colors shadow-sm"
              >
                <Save className="w-3 h-3" />
                Save Changes
              </button>
            </div>
          </div>
        ) : (
          <div className="font-mono text-xs leading-relaxed break-all bg-zinc-50/50 p-4 rounded-lg border border-zinc-100/50">
            {renderSequence()}
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-4">
          {sortedCdrs.map((cdr) => {
            const isUnverified = cdr.start === -1;
            return (
              <div key={cdr.type} className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-zinc-400 uppercase font-bold tracking-wider">{cdr.type}</span>
                  {isUnverified && (
                    <span 
                      className="text-[8px] bg-rose-50 text-rose-600 px-1 rounded flex items-center gap-0.5 font-bold animate-pulse"
                      title="Sequence was extracted but not found in the full Variable Domain sequence"
                    >
                      <AlertCircle className="w-2 h-2" />
                      UNVERIFIED
                    </span>
                  )}
                </div>
                <div className={cn(
                  "bg-zinc-50 border rounded px-2 py-1",
                  isUnverified ? "border-rose-100 bg-rose-50/10" : "border-zinc-100"
                )}>
                  <span className={cn(
                    "text-[10px] font-mono font-bold truncate block",
                    isUnverified ? "text-rose-600 italic" : "text-zinc-700"
                  )}>
                    {cdr.sequence || 'Not found'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
