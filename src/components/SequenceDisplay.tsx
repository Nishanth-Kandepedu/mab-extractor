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
  const { fullSequence, cdrs, type } = chain;
  const [isEditing, setIsEditing] = React.useState(false);
  const [tempSequence, setTempSequence] = React.useState(fullSequence);
  const [copied, setCopied] = React.useState(false);

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
    let lastIndex = 0;

    sortedCdrs.forEach((cdr, idx) => {
      // Add non-CDR part
      if (cdr.start > lastIndex) {
        parts.push(
          <span key={`non-cdr-${idx}`} className="text-zinc-400">
            {fullSequence.slice(lastIndex, cdr.start)}
          </span>
        );
      }

      // Add CDR part
      const cdrColor = 
        cdr.type === 'CDR1' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' :
        cdr.type === 'CDR2' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
        'bg-amber-50 text-amber-700 border-amber-100';

      parts.push(
        <span 
          key={`cdr-${idx}`} 
          className={cn(
            "px-0.5 rounded border font-bold relative group cursor-default transition-all hover:scale-105",
            cdrColor
          )}
        >
          {cdr.sequence}
          <span className="absolute -top-6 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-[9px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 shadow-lg">
            {cdr.type}
          </span>
        </span>
      );

      lastIndex = cdr.end;
    });

    // Add remaining part
    if (lastIndex < fullSequence.length) {
      parts.push(
        <span key="final-part" className="text-zinc-400">
          {fullSequence.slice(lastIndex)}
        </span>
      );
    }

    return parts;
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <div className="bg-zinc-50 border-b border-zinc-200 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-2 h-2 rounded-full",
            type === 'Heavy' ? "bg-indigo-500" : "bg-emerald-500"
          )} />
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            {type} Chain Variable Region
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {isEditable && !isEditing && (
            <button 
              onClick={() => setIsEditing(true)}
              className="p-1.5 text-zinc-400 hover:text-indigo-600 transition-colors"
              title="Edit Sequence"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button 
            onClick={handleCopy}
            className="p-1.5 text-zinc-400 hover:text-indigo-600 transition-colors"
            title="Copy Sequence"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <span className="text-[10px] font-mono bg-white border border-zinc-200 text-zinc-500 px-2 py-0.5 rounded shadow-sm">
            {fullSequence.length} AA
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
          {sortedCdrs.map((cdr) => (
            <div key={cdr.type} className="flex flex-col gap-1">
              <span className="text-[9px] text-zinc-400 uppercase font-bold tracking-wider">{cdr.type}</span>
              <div className="bg-zinc-50 border border-zinc-100 rounded px-2 py-1">
                <span className="text-[10px] font-mono font-bold text-zinc-700 truncate block">{cdr.sequence}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
