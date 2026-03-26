import React from 'react';
import { Chain, CDR } from '../types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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

  // Sort CDRs by start position
  const sortedCdrs = [...cdrs].sort((a, b) => a.start - b.start);

  const renderSequence = () => {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;

    sortedCdrs.forEach((cdr, idx) => {
      // Add non-CDR part
      if (cdr.start > lastIndex) {
        parts.push(
          <span key={`non-cdr-${idx}`} className="text-zinc-500">
            {fullSequence.slice(lastIndex, cdr.start)}
          </span>
        );
      }

      // Add CDR part
      const cdrColor = 
        cdr.type === 'CDR1' ? 'bg-emerald-100 text-emerald-900 border-emerald-200' :
        cdr.type === 'CDR2' ? 'bg-indigo-100 text-indigo-900 border-indigo-200' :
        'bg-amber-100 text-amber-900 border-amber-200';

      parts.push(
        <span 
          key={`cdr-${idx}`} 
          className={cn(
            "px-0.5 rounded border font-bold relative group cursor-default",
            cdrColor
          )}
          title={cdr.type}
        >
          {cdr.sequence}
          <span className="absolute -top-6 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
            {cdr.type}
          </span>
        </span>
      );

      lastIndex = cdr.end;
    });

    // Add remaining part
    if (lastIndex < fullSequence.length) {
      parts.push(
        <span key="final-part" className="text-zinc-500">
          {fullSequence.slice(lastIndex)}
        </span>
      );
    }

    return parts;
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className={cn(
          "text-sm font-semibold uppercase tracking-wider",
          type === 'Heavy' ? 'text-indigo-600' : 'text-emerald-600'
        )}>
          {type} Chain Variable Region
        </h3>
        <div className="flex items-center gap-2">
          {isEditable && !isEditing && (
            <button 
              onClick={() => setIsEditing(true)}
              className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 uppercase tracking-wider px-2 py-1 bg-indigo-50 rounded"
            >
              Edit Sequence
            </button>
          )}
          <span className="text-[10px] font-mono bg-zinc-100 text-zinc-500 px-2 py-1 rounded">
            {fullSequence.length} AA
          </span>
        </div>
      </div>
      
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
              className="px-3 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-700"
            >
              Cancel
            </button>
            <button 
              onClick={handleSave}
              className="px-3 py-1 bg-indigo-600 text-white text-xs font-medium rounded hover:bg-indigo-700 transition-colors"
            >
              Save Changes
            </button>
          </div>
        </div>
      ) : (
        <div className="font-mono text-sm leading-relaxed break-all bg-zinc-50 p-4 rounded-lg border border-zinc-100">
          {renderSequence()}
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2">
        {sortedCdrs.map((cdr) => (
          <div key={cdr.type} className="flex flex-col">
            <span className="text-[10px] text-zinc-400 uppercase font-semibold">{cdr.type}</span>
            <span className="text-xs font-mono truncate">{cdr.sequence}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
