import React from 'react';
import { Chain, CDR } from '../types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Copy, Check, Edit2, X, Save } from 'lucide-react';

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
      const cdr = sortedCdrs.find(c => i >= c.start && i < c.end);
      
      const cdrColor = cdr ? (
        cdr.type === 'CDR1' ? 'bg-indigo-50 text-indigo-700 border-indigo-100 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.1)]' :
        cdr.type === 'CDR2' ? 'bg-emerald-50 text-emerald-700 border-emerald-100 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.1)]' :
        'bg-amber-50 text-amber-700 border-amber-100 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.1)]'
      ) : '';

      parts.push(
        <span 
          key={i} 
          className={cn(
            "inline-block transition-all",
            isNonStandard && "bg-red-500 text-white font-bold px-0.5 rounded shadow-[0_0_8px_rgba(239,68,68,0.4)]",
            cdr && !isNonStandard && cn("px-0.5 rounded border font-bold relative group cursor-default", cdrColor),
            !cdr && !isNonStandard && "text-zinc-400 hover:text-zinc-600"
          )}
        >
          {char}
          {cdr && i === cdr.start && (
            <span className="absolute -top-7 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-[8px] px-1.5 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-all transform scale-90 group-hover:scale-100 whitespace-nowrap z-10 shadow-xl border border-white/10">
              {cdr.type}
            </span>
          )}
        </span>
      );
    }

    return parts;
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-[28px] overflow-hidden shadow-sm hover:shadow-md transition-all duration-300">
      <div className="bg-white border-b border-zinc-100 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={cn(
            "w-3 h-3 rounded-full shadow-inner",
            type === 'Heavy' ? "bg-gradient-to-br from-indigo-400 to-indigo-600" : "bg-gradient-to-br from-emerald-400 to-emerald-600"
          )} />
          <div className="flex flex-col">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 leading-none mb-1">
              {type} Domain
            </h3>
            <div className="flex items-center gap-2">
              {seqId && <span className="text-xs font-bold text-zinc-900 font-mono tracking-tight">{seqId}</span>}
              <div className="flex items-center gap-1.5">
                {pageNumber && (
                   <span className="text-[9px] font-black text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full leading-none">
                     P{pageNumber}
                   </span>
                )}
                {tableId && (
                   <span className="text-[9px] font-black text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full leading-none">
                     {tableId}
                   </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {target && (
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-black text-amber-500 uppercase tracking-widest leading-none mb-1">Target</span>
              <span className="text-xs font-bold text-zinc-900 tracking-tight">{target}</span>
            </div>
          )}
          <div className="h-8 w-px bg-zinc-100" />
          <div className="flex items-center gap-1">
            {isEditable && !isEditing && (
              <button 
                onClick={() => setIsEditing(true)}
                className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-all"
                title="Edit Sequence"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button 
              onClick={handleCopy}
              className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-all"
              title="Copy Sequence"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <div className="ml-2 bg-zinc-50 border border-zinc-100 px-3 py-1 rounded-full flex items-center gap-1.5">
               <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Size</span>
               <span className="text-[10px] font-bold text-zinc-900 font-mono">{fullSequence.length}</span>
            </div>
          </div>
        </div>
      </div>
      
      <div className="p-6">
        {isEditing ? (
          <div className="space-y-4">
            <textarea
              value={tempSequence}
              onChange={(e) => setTempSequence(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
              className="w-full h-40 bg-zinc-50 border border-zinc-100 rounded-[20px] p-6 text-sm font-mono focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500 transition-all resize-none shadow-inner"
              placeholder="Input amino acid sequence..."
            />
            <div className="flex justify-end gap-3">
              <button 
                onClick={handleCancel}
                className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleSave}
                className="flex items-center gap-2 px-6 py-2 bg-[#050505] text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-zinc-800 transition-all shadow-xl active:scale-95"
              >
                <Save className="w-3.5 h-3.5" />
                Commit Sequence
              </button>
            </div>
          </div>
        ) : (
          <div className="font-mono text-[13px] leading-relaxed break-all bg-zinc-50/30 p-6 rounded-[24px] border border-zinc-100/30 shadow-inner group-hover:bg-zinc-50/50 transition-colors duration-300">
            {renderSequence()}
          </div>
        )}

        <div className="mt-8">
           <div className="flex items-center gap-2 mb-4">
              <span className="h-px flex-1 bg-zinc-100" />
              <span className="text-[9px] font-black text-zinc-300 uppercase tracking-[0.3em]">Hypervariable Regions</span>
              <span className="h-px flex-1 bg-zinc-100" />
           </div>
           <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {sortedCdrs.map((cdr) => (
                <div key={cdr.type} className="group/cdr">
                  <span className={cn(
                    "text-[10px] font-black uppercase tracking-widest leading-none mb-2 block",
                    cdr.type === 'CDR1' ? 'text-indigo-400' : cdr.type === 'CDR2' ? 'text-emerald-400' : 'text-amber-400'
                  )}>
                    {cdr.type}
                  </span>
                  <div className="bg-white border border-zinc-100 rounded-2xl px-4 py-3 group-hover/cdr:border-zinc-200 transition-all shadow-sm">
                    <span className="text-[11px] font-bold font-mono text-zinc-700 break-all leading-relaxed">
                      {cdr.sequence || 'Not detected'}
                    </span>
                  </div>
                </div>
              ))}
           </div>
        </div>
      </div>
    </div>
  );
};
