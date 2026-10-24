import React from 'react';

// Circle-outline logo mark and the StockSense name in the wordmark style.
export const Wordmark: React.FC<{ size?: 'md' | 'lg' }> = ({ size = 'md' }) => (
  <div className="flex flex-col items-center gap-3">
    <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[#1f4d3a]">
      <span className="h-5 w-5 rounded-full bg-[#2f6b4f]" aria-hidden="true" />
    </div>
    <div className="text-center">
      <h1 className={`wordmark ${size === 'lg' ? 'text-4xl' : 'text-3xl'}`}>StockSense</h1>
      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Lab inventory &amp; procurement</p>
    </div>
  </div>
);
