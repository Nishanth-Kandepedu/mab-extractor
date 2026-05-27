# Cheminformatic Labs — Reusable UI Design System & Wireframe Spec
This document outlines the visual standards, responsive grids, border properties, interactive highlights, and pure wireframe templates for Cheminformatic Labs products. It is structured abstractly so you can swap out parameters (like `[BRAND_NAME]` / `[APP_NAME]`) to build matches like *SARMiner*, *PatentMiner*, or *LeadMiner* without messing up application state engines.

---

## 1. Visual Theme, Palette, & Mood
The design system of Cheminformatic Labs matches **clinical scientific precision** with **high-density executive utility**. It avoids flat tech-defaults and focuses heavily on negative space, micro-borders, and high-density technical layouts.

### A. The Core Neutral Palette (85% of Visual Framework)
The system leverages high-quality light workspace layouts paired with dark side-drawers or heavy header modules to anchor the visual weight.

*   **Dark Neutral Plate** (`bg-zinc-950` / `bg-zinc-900`): Dark charcoal used for main top headers, system landing sections, or action drawers.
*   **Aesthetic Off-White Workspace** (`bg-zinc-50` / `bg-white`): Standard content canvas, table containers, search modules, and output grids.
*   **Micro-Borders & Grids** (`border-zinc-200`): Every tile or list card is separated by a thin neutral border to preserve data clarity.
    *   *Light Theme:* `border-zinc-200/80` or `border-zinc-100` (for secondary tiers).
    *   *Dark Theme:* `border-white/10` or `border-zinc-800/60`.

### B. Functional Action Colors
Functional indicators use controlled, high-intensity color accents:
*   **Brand / Action Primary** (`text-indigo-600` / `bg-indigo-50` / `hover:bg-indigo-100`): Brand accents and primary actions.
*   **Approved / Verified State** (`text-emerald-600` / `bg-emerald-50` / `border-emerald-200`): Cleared, finished, or safe matches.
*   **Warning / Needs Review State** (`text-amber-800` / `bg-amber-50` / `border-amber-200`): Sequences containing warnings, anomalies, or draft indicators.

---

## 2. Typography Pairings & Hierarchy
Configure these font pairings inside your layout files to create high scannability:

```css
/* Import Rule for Google Fonts */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');
```

| Type Role | Font Family | Tailwinds Class | Usage |
| :--- | :--- | :--- | :--- |
| **Display Header** | Space Grotesk | `font-display font-medium` | Brands, section title lines, hero greetings |
| **General UI Copy** | Inter (Sans-serif) | `font-sans antialiased` | Data descriptors, menu options, form controls |
| **Structured Output**| JetBrains Mono | `font-mono tracking-tight` | Alignment values, code codes, exact values, counts |

### Sizing and Letter Spacings
*   **Main Branding Title:** `text-lg font-bold tracking-tight text-white` (Clean, non-shouting Display).
*   **Technical Sub-Bands:** `text-[9px] uppercase font-bold tracking-widest text-indigo-400` (Always positioned directly beneath the main brand name).
*   **Form Action Labels:** `text-[10px] font-sans font-bold uppercase tracking-widest text-zinc-500` (Dense, clear uppercase labels).

---

## 3. Pure Wireframe HTML/JSX Structure
Use this nested layout pattern to maintain structural unity across arbitrary full-screen views.

```tsx
export default function UniversalLayout() {
  return (
    <div className="min-h-screen bg-zinc-50 font-sans flex flex-col antialiased">
      
      {/* 1. Header Band (Dark Theme) */}
      <header className="bg-zinc-950 border-b border-white/10 px-8 py-4 text-white">
        <div className="max-w-[1600px] w-full mx-auto flex items-center justify-between">
          
          {/* Logo & Sub-Brand Block */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold">L</div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-display font-bold tracking-tight text-white">[APP_NAME]</h1>
                <span className="text-[9px] font-bold text-zinc-400 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded-sm uppercase tracking-wider">
                  [COMPANY_NAME]
                </span>
              </div>
              <p className="text-[9px] text-indigo-400 font-bold uppercase tracking-widest">[APP_TAGLINE]</p>
            </div>
          </div>

          {/* User Profile / Access Tier Badge */}
          <div className="flex items-center gap-4">
            <span className="text-xs text-zinc-400 font-medium">Guest User</span>
            <span className="text-[9px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
              Level 1 Access
            </span>
          </div>

        </div>
      </header>

      {/* 2. Main Workspace Layout */}
      <main className="max-w-[1600px] w-full mx-auto px-8 py-8 flex-1 flex flex-col gap-8">
        
        {/* Metric Cards Ribbon (Flexible Metric Columns) */}
        <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white border border-zinc-200/80 rounded-2xl p-5 shadow-sm">
            <span className="text-[9px] text-zinc-400 uppercase font-bold tracking-widest">[METRIC_1_LABEL]</span>
            <div className="text-2xl font-display font-bold text-zinc-900 mt-1">[METRIC_1_VALUE]</div>
          </div>
          <div className="bg-white border border-zinc-200/80 rounded-2xl p-5 shadow-sm">
            <span className="text-[9px] text-zinc-400 uppercase font-bold tracking-widest">[METRIC_2_LABEL]</span>
            <div className="text-2xl font-display font-bold text-zinc-900 mt-1">[METRIC_2_VALUE]</div>
          </div>
          <div className="bg-white border border-zinc-200/80 rounded-2xl p-5 shadow-sm border-emerald-200 bg-emerald-50/10">
            <span className="text-[9px] text-emerald-600 uppercase font-bold tracking-widest">[METRIC_3_LABEL]</span>
            <div className="text-2xl font-display font-bold text-emerald-800 mt-1">[METRIC_3_VALUE]</div>
          </div>
          <div className="bg-white border border-zinc-200/80 rounded-2xl p-5 shadow-sm">
            <span className="text-[9px] text-zinc-400 uppercase font-bold tracking-widest">[METRIC_4_LABEL]</span>
            <div className="text-2xl font-display font-bold text-zinc-900 mt-1">[METRIC_4_VALUE]</div>
          </div>
        </section>

        {/* Workspace Panels split (60 / 40 or 70 / 30 layout) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          
          {/* Main Control Panel and Lists */}
          <div className="lg:col-span-2 bg-white border border-zinc-200/80 rounded-3xl p-6 shadow-sm flex flex-col gap-6">
            <h2 className="text-lg font-display font-bold tracking-tight text-zinc-900">[WORKSPACE_SECTION_TITLE]</h2>
            <div className="h-[300px] border border-dashed border-zinc-200 rounded-2xl flex items-center justify-center text-zinc-400 hover:border-zinc-300 transition-colors">
              [PLACE_YOUR_PRIMARY_LISTS_OR_FORMS_HERE]
            </div>
          </div>

          {/* Side Drawer Info Cards */}
          <div className="bg-white border border-zinc-200/80 rounded-3xl p-6 shadow-sm flex flex-col gap-6">
            <h2 className="text-lg font-display font-bold tracking-tight text-zinc-900">[INSPECTOR_PANEL_TITLE]</h2>
            <div className="h-[300px] border border-dashed border-zinc-200 rounded-2xl flex items-center justify-center text-zinc-400">
              [PLACE_YOUR_DETAIL_INSPECTORS_HERE]
            </div>
          </div>

        </div>

      </main>

      {/* 3. Global Footer Band (Light Theme) */}
      <footer className="max-w-[1600px] w-full mx-auto px-8 py-8 border-t border-zinc-200 mt-auto flex flex-col md:flex-row items-center justify-between gap-6 text-[11px] text-zinc-500">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono font-bold uppercase tracking-wider text-zinc-400">[SUBDOMAIN_OR_URL_PLACEHOLDER]</span>
          <p className="text-zinc-400 font-medium">A Product of [COMPANY_NAME] LLP © 2026. All Rights Reserved.</p>
        </div>
        <div className="flex gap-8">
          <div className="flex flex-col">
            <span className="text-[9px] text-zinc-400 uppercase font-bold mb-1">Processing Mode</span>
            <span className="font-medium text-zinc-700">[PROCESSING_STATUS_TEXT]</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] text-zinc-400 uppercase font-bold mb-1">Session Protocol</span>
            <span className="font-medium text-zinc-700">Encrypted Admin Session</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
```

---

## 4. Reusable Visual Box Layout Styles

### A. High Density Grid Cells
Use this style block to align key-value listings or technical summaries side-by-side with monospaced accents. This avoids table stretch while presenting dense textual readings:
```tsx
<div className="grid grid-cols-2 gap-4 border border-zinc-100 rounded-2xl p-4 bg-zinc-50/50">
  <div>
    <span className="text-[9px] text-zinc-400 font-bold uppercase">[PARAMETER]</span>
    <p className="text-xs text-zinc-800 font-semibold">[VALUE]</p>
  </div>
  <div>
    <span className="text-[9px] text-zinc-400 font-bold uppercase">[UNIT]</span>
    <p className="text-xs text-zinc-500 font-mono">[VALUE_MONOSPACED]</p>
  </div>
</div>
```

### B. Inline Warning Banner
Ideal for displaying notices or low-confidence indicators without covering content:
```tsx
<div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-2xl text-xs flex gap-3 items-start">
  <div className="w-5 h-5 rounded-md bg-amber-100/80 border border-amber-200 flex items-center justify-center font-bold text-[10px] text-amber-800">i</div>
  <div>
    <p className="font-bold">[A_WARNING_OCCURRED]</p>
    <p className="text-amber-700 mt-0.5 leading-relaxed">[REASONING_AND_RECOMMENDED_CORRECTIVE_ACTIONS]</p>
  </div>
</div>
```
