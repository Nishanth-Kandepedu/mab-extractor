# Cheminformatic Labs Design System
A design system and template blueprint for **Cheminformatic Labs** products (e.g., *AbMiner*, *SARMiner*, *LeadMiner*, or *PolyMiner*). It defines the exact typography pairing, color choices, boarder treatments, interactive layout frames, and micro-interactions that make the platform feel polished, scientific, and highly executive.

---

## 1. Aesthetic Identity & Mood
The design philosophy of Cheminformatic Labs balances **pristine scientific precision** with **high-contrast executive utility**. It avoids flat tech-defaults (e.g. standard blue/purple gradients) and focuses heavily on negative space, micro-borders, and high-density technical layouts.

| Dimension | Rule | Visual Translation |
| :--- | :--- | :--- |
| **Typography** | Swiss technical contrast | Display Sans-Serif + Monospace alignments |
| **Borders** | Micro-thin separations | `border-zinc-200` (Light) or `border-white/10` (Dark) |
| **Plates** | Slate hybrid panels | Soft off-white backgrounds + pitch-charcoal headers |
| **Interactions** | Snappy, tactile response | Discrete transitions, subtle borders, and smooth scaling |

---

## 2. Shared Color Palette

### A. Core Neutral Slate (85% of visual framework)
The core app rests on high-quality light workspace layouts paired with deep slate-dark navigation blocks:
*   **Deep Space Gray** (`bg-zinc-950` / `bg-zinc-900`): Used for side panels, header banners, and heavy system cards to draw high contrast.
*   **Aesthetic Off-White** (`bg-zinc-50` / `bg-white`): Used for the main interactive pages, canvas tools, and spreadsheets.
*   **Micro-borders** (`neutral border`):
    *   Light theme: `border-zinc-200/80`
    *   Dark theme: `border-white/10`

### B. High-Curation Highlights
Primary indicators use high-intensity, clinical accents:
*   **Primary Accent** (`text-indigo-600` / `bg-indigo-50`): For brand anchors, indicators, actions, and primary badges.
*   **Success Indicator** (`text-emerald-600` / `bg-emerald-50`): For fully verified sequences and complete states.
*   **Warning / Review Indicator** (`text-amber-800` / `bg-amber-50` / `border-amber-200`): For sequences containing non-standard amino acids, potential length-anomalies, constant regions, or low-confidence readings.

---

## 3. Typography & Google Fonts Spec
Include the following import rules at the top of the global CSS entry-point:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');
@import "tailwindcss";

@theme {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Space Grotesk", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
}
```

### Typographic Hierarchy Rules
*   **Hero Headings / Main Brand Names**: Use display font, with medium/bold tracking tight:
    `<h1 className="font-display font-bold tracking-tight text-white text-3xl">SubAppName</h1>`
*   **General UI labels & buttons**: Use standard sans font, high weight, tracking wide, and uppercase for indicators:
    `<span className="font-sans font-bold text-[10px] uppercase tracking-widest text-zinc-500">Label</span>`
*   **Sequence Data & Mathematical Values**: Use monospace alignment to avoid spatial distortion:
    `<span className="font-mono text-xs text-zinc-700 tracking-normal font-medium">EVQLVESGGGLVQPG</span>`

---

## 4. Reusable Component Code Patterns

### A. The Neural Loader Template (Tactile & Purposeful)
This loading design avoids traditional boring spinners. It uses an active, jitter-controlled looping timer with progressive task list sequences to create anticipation:

```tsx
import React, { useState, useEffect } from 'react';
import { Database } from 'lucide-react';
import { motion } from 'motion/react';

export const ScientificLoader = ({ statusText }: { statusText?: string }) => {
  const steps = [
    "Initializing Neural Engine",
    "Identifying Variable Patterns",
    "Processing Multimodal Signals",
    "Validating Verbatim Integrity",
    "Synchronizing Domain Coordinates",
  ];
  
  const [timer, setTimer] = useState(0);
  
  useEffect(() => {
    const interval = setInterval(() => setTimer(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-white p-8 border border-zinc-100 rounded-3xl min-h-[400px]">
      <div className="relative mb-8">
        <div className="w-24 h-24 rounded-full border-4 border-indigo-50 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-600 border-r-indigo-600 animate-spin" />
          <Database className="w-8 h-8 text-indigo-600" />
        </div>
      </div>
      
      <h2 className="text-xl font-bold text-zinc-900 mb-2 tracking-tight">Processing Scientific Text</h2>
      
      <div className="mb-6">
        <span className="px-4 py-1.5 bg-zinc-900 text-white rounded-full text-sm font-bold font-mono">
          {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, '0')}
        </span>
      </div>
      
      <div className="text-center font-sans">
        {statusText ? (
          <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest">{statusText}</p>
        ) : (
          steps.map((step, i) => (
            <p 
              key={i} 
              className={`text-xs tracking-wide transition-all duration-300 mb-1 ${
                i === Math.floor((timer / 6) % steps.length) ? "text-indigo-600 font-bold" : "text-zinc-300"
              }`}
            >
              {step}
            </p>
          ))
        )}
      </div>
    </div>
  );
};
```

---

### B. Mapped Sequence Display Template (High-Density Visualization)
Use this CSS & JSX implementation to highlight sequence alignments (such as CDRs, conserved sequences, mutations, or key markers) directly in place with elegant hover popovers:

```tsx
import React from 'react';

interface Segment {
  sequence: string;
  start: number;
  end: number;
  type: string;
}

export const SequenceViewer = ({ fullSequence, segments }: { fullSequence: string; segments: Segment[] }) => {
  // Split sequence into highlighted chunks
  const renderSequence = () => {
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;

    // Sort segments by starting position
    const sortedSegments = [...segments].sort((a, b) => a.start - b.start);

    sortedSegments.forEach((segment, idx) => {
      // Append normal preceding sequence
      if (segment.start > lastIndex) {
        elements.push(
          <span key={`normal-${idx}`} className="text-zinc-500">
            {fullSequence.substring(lastIndex, segment.start)}
          </span>
        );
      }

      // Determine segment-specific colors
      let badgeColor = "bg-indigo-500/10 text-indigo-700 border-indigo-200";
      if (segment.type === 'CDR3') badgeColor = "bg-rose-500/10 text-rose-700 border-rose-200";
      else if (segment.type === 'CDR2') badgeColor = "bg-amber-500/10 text-amber-700 border-amber-200";

      // Append Highlighted Segment
      elements.push(
        <span 
          key={`segment-${idx}`} 
          className={`px-1 py-0.5 border rounded-md font-bold transition-all hover:scale-[1.02] cursor-help relative group inline-block ${badgeColor}`}
        >
          {segment.sequence}
          
          {/* Subtle Hover Coordinate Bubble */}
          <span className="opacity-0 group-hover:opacity-100 absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 bg-zinc-900 text-white text-[9px] font-mono rounded px-1.5 py-0.5 pointer-events-none transition-all z-10 whitespace-nowrap">
            {segment.type}: {segment.start}-{segment.end}
          </span>
        </span>
      );

      lastIndex = segment.end;
    });

    // Append remaining normal trailing sequence
    if (lastIndex < fullSequence.length) {
      elements.push(
        <span key="normal-end" className="text-zinc-500">
          {fullSequence.substring(lastIndex)}
        </span>
      );
    }

    return elements;
  };

  return (
    <div className="bg-zinc-50 border border-zinc-200/80 rounded-2xl p-4 font-mono text-xs leading-relaxed tracking-wider break-all shadow-sm">
      <div className="flex justify-between items-center mb-3 pb-2 border-b border-zinc-100">
        <span className="text-[10px] font-sans font-bold text-zinc-400 uppercase tracking-widest">Sequence Coverage Map</span>
        <span className="text-[10px] font-mono text-zinc-400">{fullSequence.length} Residues</span>
      </div>
      <div>{renderSequence()}</div>
    </div>
  );
};
```

---

### C. Elegant Metric Card Template
A template card optimized to display extraction statistics, computing parameters, or numeric scientific ranges (e.g. molecular weights, sequence variants, or accuracy ratings) without adding artificial clutter:

```tsx
import React from 'react';
import { Activity } from 'lucide-react';

export const DashboardCard = ({ title, value, detail }: { title: string; value: string | number; detail: string }) => {
  return (
    <div className="bg-white border border-zinc-200/80 rounded-2xl p-5 shadow-sm transition-all hover:border-zinc-300">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-widest">{title}</span>
        <div className="w-5 h-5 rounded-md bg-indigo-50 border border-indigo-100 flex items-center justify-center">
          <Activity className="w-3 h-3 text-indigo-500" />
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold font-display tracking-tight text-zinc-900">{value}</span>
        <span className="text-[10px] text-zinc-400 font-medium font-sans">{detail}</span>
      </div>
    </div>
  );
};
```
