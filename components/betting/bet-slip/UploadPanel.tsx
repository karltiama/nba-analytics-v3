'use client';

import { useCallback, useId, useState } from 'react';
import { ImageUp } from 'lucide-react';
import { cn } from '@/lib/utils';

const ACCEPT = 'image/jpeg,image/png,image/webp';
const MAX_MB = 6;

type UploadPanelProps = {
  disabled?: boolean;
  onFile: (file: File) => void;
  error?: string | null;
};

export function UploadPanel({ disabled, onFile, error }: UploadPanelProps) {
  const id = useId();
  const [drag, setDrag] = useState(false);

  const validateAndEmit = useCallback(
    (file: File) => {
      const okType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
      if (!okType) {
        return;
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        return;
      }
      onFile(file);
    },
    [onFile]
  );

  return (
    <div
      className={cn(
        'rounded-xl border border-dashed border-white/20 bg-secondary/20 p-8 text-center transition-colors',
        drag && 'border-[#00d4ff]/50 bg-[#00d4ff]/5',
        disabled && 'opacity-60 pointer-events-none'
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) validateAndEmit(f);
      }}
    >
      <input
        id={id}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) validateAndEmit(f);
          e.target.value = '';
        }}
      />
      <label htmlFor={id} className="cursor-pointer flex flex-col items-center gap-3">
        <div className="rounded-xl bg-white/5 p-4">
          <ImageUp className="w-10 h-10 text-[#00d4ff]" />
        </div>
        <div>
          <span className="text-white font-medium">Drop a bet slip screenshot</span>
          <p className="text-sm text-muted-foreground mt-1">
            JPEG, PNG, or WebP · up to {MAX_MB} MB
          </p>
        </div>
        <span className="text-xs text-[#00d4ff]">or click to browse</span>
      </label>
      {error ? <p className="text-sm text-red-400 mt-4">{error}</p> : null}
    </div>
  );
}
