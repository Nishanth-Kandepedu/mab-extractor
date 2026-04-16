import React from 'react';
import { Antibody } from '../types';
import { 
  Target, 
  Zap, 
  Activity, 
  FlaskConical, 
  MapPin, 
  Factory, 
  FileText,
  ChevronDown,
  ChevronUp,
  Info
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface AntibodyDetailsProps {
  antibody: Antibody;
}

const SectionHeader: React.FC<{ 
  icon: React.ElementType; 
  title: string; 
  isOpen: boolean; 
  onToggle: () => void;
  hasData: boolean;
}> = ({ icon: Icon, title, isOpen, onToggle, hasData }) => (
  <button 
    onClick={onToggle}
    className={cn(
      "w-full flex items-center justify-between p-4 bg-zinc-50 hover:bg-zinc-100 transition-colors border-b border-zinc-200",
      !hasData && "opacity-50 grayscale cursor-not-allowed"
    )}
    disabled={!hasData}
  >
    <div className="flex items-center gap-3">
      <div className="p-2 bg-white rounded-lg border border-zinc-200 shadow-sm">
        <Icon className="w-4 h-4 text-indigo-600" />
      </div>
      <span className="text-sm font-bold text-zinc-700 uppercase tracking-wider">{title}</span>
      {!hasData && <span className="text-[10px] text-zinc-400 font-normal normal-case italic">(No data found)</span>}
    </div>
    {hasData && (isOpen ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />)}
  </button>
);

const DataItem: React.FC<{ label: string; value: string | number | null | undefined; unit?: string }> = ({ label, value, unit }) => {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">{label}</span>
      <span className="text-xs font-medium text-zinc-700">
        {value} {unit && <span className="text-zinc-400 font-normal">{unit}</span>}
      </span>
    </div>
  );
};

export const AntibodyDetails: React.FC<AntibodyDetailsProps> = ({ antibody }) => {
  const [openSections, setOpenSections] = React.useState<Record<string, boolean>>({
    target: true,
    sar: false,
    spr: false,
    adme: false,
    epitope: false,
    manufacturing: false
  });

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const hasTarget = !!antibody.target?.antigen_name;
  const hasSAR = !!(antibody.sar?.structure_activity_relationships?.length || antibody.sar?.key_residues?.length);
  const hasSPR = !!(antibody.spr?.kd?.value || antibody.spr?.kon?.value || antibody.spr?.koff?.value);
  const hasADME = !!(antibody.adme_dmpk?.half_life?.value || antibody.adme_dmpk?.clearance?.value || antibody.adme_dmpk?.bioavailability?.value);
  const hasEpitope = !!(antibody.epitope?.epitope_type || antibody.epitope?.binding_residues?.length);
  const hasManufacturing = !!(antibody.manufacturing?.expression_system?.host_cell || antibody.manufacturing?.production_yield?.value);

  return (
    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
      {/* Target Info */}
      <SectionHeader 
        icon={Target} 
        title="Target Antigen" 
        isOpen={openSections.target} 
        onToggle={() => toggleSection('target')}
        hasData={hasTarget}
      />
      {openSections.target && hasTarget && (
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-6 bg-white">
          <DataItem label="Antigen Name" value={antibody.target?.antigen_name} />
          <DataItem label="Species" value={antibody.target?.species} />
          <DataItem label="Confidence" value={antibody.target?.confidence} />
          {antibody.target?.antigen_aliases && antibody.target.antigen_aliases.length > 0 && (
            <div className="flex flex-col gap-1 col-span-2">
              <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">Aliases</span>
              <div className="flex flex-wrap gap-2">
                {antibody.target.antigen_aliases.map((alias, i) => (
                  <span key={i} className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded text-[10px] border border-zinc-200">
                    {alias}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SAR Info */}
      <SectionHeader 
        icon={Zap} 
        title="SAR & Mutations" 
        isOpen={openSections.sar} 
        onToggle={() => toggleSection('sar')}
        hasData={hasSAR}
      />
      {openSections.sar && hasSAR && (
        <div className="p-4 space-y-6 bg-white">
          {antibody.sar?.structure_activity_relationships && antibody.sar.structure_activity_relationships.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-100">
                    <th className="pb-2 font-bold text-zinc-400 uppercase tracking-wider text-[9px]">Position</th>
                    <th className="pb-2 font-bold text-zinc-400 uppercase tracking-wider text-[9px]">Mutation</th>
                    <th className="pb-2 font-bold text-zinc-400 uppercase tracking-wider text-[9px]">Effect</th>
                    <th className="pb-2 font-bold text-zinc-400 uppercase tracking-wider text-[9px]">Magnitude</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {antibody.sar.structure_activity_relationships.map((rel, i) => (
                    <tr key={i}>
                      <td className="py-2 font-mono text-zinc-600">{rel.mutation_position}</td>
                      <td className="py-2 text-zinc-700">{rel.mutation_type}</td>
                      <td className="py-2 text-zinc-700">{rel.effect_on_binding}</td>
                      <td className="py-2 text-zinc-700">{rel.effect_magnitude}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SPR Info */}
      <SectionHeader 
        icon={Activity} 
        title="Binding Kinetics (SPR)" 
        isOpen={openSections.spr} 
        onToggle={() => toggleSection('spr')}
        hasData={hasSPR}
      />
      {openSections.spr && hasSPR && (
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-6 bg-white">
          <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-100">
            <DataItem label="KD (Affinity)" value={antibody.spr?.kd?.value} unit={antibody.spr?.kd?.unit} />
            <div className="mt-2 text-[9px] text-zinc-400 italic">{antibody.spr?.kd?.method}</div>
          </div>
          <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-100">
            <DataItem label="kon (On-rate)" value={antibody.spr?.kon?.value} unit={antibody.spr?.kon?.unit} />
          </div>
          <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-100">
            <DataItem label="koff (Off-rate)" value={antibody.spr?.koff?.value} unit={antibody.spr?.koff?.unit} />
          </div>
        </div>
      )}

      {/* ADME Info */}
      <SectionHeader 
        icon={FlaskConical} 
        title="ADME & PK Profile" 
        isOpen={openSections.adme} 
        onToggle={() => toggleSection('adme')}
        hasData={hasADME}
      />
      {openSections.adme && hasADME && (
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-6 bg-white">
          <DataItem label="Half-life" value={antibody.adme_dmpk?.half_life?.value} unit={antibody.adme_dmpk?.half_life?.unit} />
          <DataItem label="Clearance" value={antibody.adme_dmpk?.clearance?.value} unit={antibody.adme_dmpk?.clearance?.unit} />
          <DataItem label="Bioavailability" value={antibody.adme_dmpk?.bioavailability?.value} unit={antibody.adme_dmpk?.bioavailability?.unit} />
          <DataItem label="Species" value={antibody.adme_dmpk?.half_life?.species} />
        </div>
      )}

      {/* Epitope Info */}
      <SectionHeader 
        icon={MapPin} 
        title="Epitope Mapping" 
        isOpen={openSections.epitope} 
        onToggle={() => toggleSection('epitope')}
        hasData={hasEpitope}
      />
      {openSections.epitope && hasEpitope && (
        <div className="p-4 space-y-4 bg-white">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <DataItem label="Epitope Type" value={antibody.epitope?.epitope_type} />
            <DataItem label="Epitope Bin" value={antibody.epitope?.epitope_bin} />
          </div>
          {antibody.epitope?.binding_residues && antibody.epitope.binding_residues.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">Binding Residues</span>
              <div className="flex flex-wrap gap-2">
                {antibody.epitope.binding_residues.map((res, i) => (
                  <div key={i} className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded border border-indigo-100 text-[10px] font-mono">
                    {res.residue_position} ({res.interaction_type})
                  </div>
                ))}
              </div>
            </div>
          )}
          {antibody.epitope?.competitive_binding && antibody.epitope.competitive_binding.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">Competitive Binding</span>
              <div className="space-y-1">
                {antibody.epitope.competitive_binding.map((comp, i) => (
                  <div key={i} className="text-xs text-zinc-600 flex items-center gap-2">
                    <div className={cn("w-1.5 h-1.5 rounded-full", comp.blocks_binding ? "bg-red-400" : "bg-emerald-400")} />
                    <span className="font-medium">{comp.competitor_antibody}</span>: {comp.blocks_binding ? "Blocks" : "Does not block"}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manufacturing Info */}
      <SectionHeader 
        icon={Factory} 
        title="Manufacturing & Quality" 
        isOpen={openSections.manufacturing} 
        onToggle={() => toggleSection('manufacturing')}
        hasData={hasManufacturing}
      />
      {openSections.manufacturing && hasManufacturing && (
        <div className="p-4 space-y-6 bg-white">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <DataItem label="Expression System" value={antibody.manufacturing?.expression_system?.host_cell} />
            <DataItem label="Cell Line" value={antibody.manufacturing?.expression_system?.cell_line_name} />
            <DataItem label="Yield" value={antibody.manufacturing?.production_yield?.value} unit={antibody.manufacturing?.production_yield?.unit} />
            <DataItem label="Final Purity" value={antibody.manufacturing?.purification?.final_purity} />
          </div>
          {antibody.manufacturing?.quality_attributes && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-4 border-t border-zinc-50">
              <DataItem label="Aggregation" value={antibody.manufacturing.quality_attributes.aggregation_level} />
              <DataItem label="Potency" value={antibody.manufacturing.quality_attributes.potency} />
              <DataItem label="Glycosylation" value={antibody.manufacturing.quality_attributes.glycosylation_profile} />
              <DataItem label="Charge Variants" value={antibody.manufacturing.quality_attributes.charge_variants} />
            </div>
          )}
        </div>
      )}

      {/* Evidence Footer */}
      <div className="p-4 bg-zinc-50 border-t border-zinc-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-3 h-3 text-zinc-400" />
          <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">Source Evidence Tracking</span>
        </div>
        <div className="flex gap-4">
          {antibody.source_evidence?.target_source && <Info className="w-3 h-3 text-indigo-400 cursor-help" title={`Target source: ${antibody.source_evidence.target_source}`} />}
          {antibody.source_evidence?.sar_source && <Info className="w-3 h-3 text-indigo-400 cursor-help" title={`SAR source: ${antibody.source_evidence.sar_source}`} />}
          {antibody.source_evidence?.spr_source && <Info className="w-3 h-3 text-indigo-400 cursor-help" title={`SPR source: ${antibody.source_evidence.spr_source}`} />}
        </div>
      </div>
    </div>
  );
};
