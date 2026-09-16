'use client';

import { useId, useRef, useState } from 'react';
import { ImageUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { XRAY_MAX_UPLOAD_BYTES } from '@/lib/parlay-xray/types';
import { displayFilename, validateParlayScreenshot } from '@/lib/parlay-xray/upload';
import type { UploadErrorCode, UploadedScreenshot } from '@/lib/parlay-xray/types';

const ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';

type UploadDropzoneProps = {
  screenshot: UploadedScreenshot | null;
  error: string | null;
  disabled?: boolean;
  onSelected: (file: UploadedScreenshot) => void;
  onRejected: (code: Extract<UploadErrorCode, 'unsupported_file' | 'file_too_large'>) => void;
  onReplaceRequest?: () => void;
  onRemove?: () => void;
  onUploadStarted?: () => void;
};

export function UploadDropzone({
  screenshot,
  error,
  disabled,
  onSelected,
  onRejected,
  onReplaceRequest,
  onRemove,
  onUploadStarted,
}: UploadDropzoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const emitFile = (file: File) => {
    const result = validateParlayScreenshot(file);
    if (!result.ok) {
      onRejected(result.code);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    onSelected({
      filename: displayFilename(file.name),
      mimeType: result.mimeType,
      sizeBytes: file.size,
      objectUrl,
    });
  };

  const openPicker = () => {
    onUploadStarted?.();
    inputRef.current?.click();
  };

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.files?.[0];
          if (next) emitFile(next);
          e.target.value = '';
        }}
      />

      {!screenshot ? (
        <div
          className={cn(
            'rounded-2xl border border-dashed border-[#DCE9EA] bg-[#f7f9f7] px-6 py-10 text-center transition-colors',
            drag && 'border-[#55ddb1] bg-[#55ddb1]/10',
            disabled && 'opacity-60 pointer-events-none'
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragEnter={() => {
            setDrag(true);
            onUploadStarted?.();
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const next = e.dataTransfer.files[0];
            if (next) emitFile(next);
          }}
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white border border-[#DCE9EA]">
            <ImageUp className="h-7 w-7 text-[#075B5C]" aria-hidden />
          </div>
          <p className="text-base font-semibold text-[#063f46]">Drop your bet slip here</p>
          <p className="mt-1 text-sm text-[#4a6366]">PNG, JPG, or WebP · max 10 MB</p>
          <button
            type="button"
            onClick={openPicker}
            className="mt-5 inline-flex items-center justify-center rounded-lg bg-[#55ddb1] px-5 py-2.5 text-sm font-semibold text-[#063f46] hover:bg-[#3dcc9f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1]/60"
          >
            Choose file
          </button>
        </div>
      ) : (
        <ScreenshotPreviewCard
          screenshot={screenshot}
          inputId={inputId}
          onReplace={() => {
            onReplaceRequest?.();
            openPicker();
          }}
          onRemove={onRemove}
        />
      )}

      {error ? (
        <p className="text-sm text-[#9a3412]" role="alert">
          {error}
        </p>
      ) : null}

      <p className="sr-only" id={`${inputId}-hint`}>
        Accepted types: PNG, JPG, WebP. Maximum {Math.round(XRAY_MAX_UPLOAD_BYTES / (1024 * 1024))} megabytes.
      </p>
    </div>
  );
}

function ScreenshotPreviewCard({
  screenshot,
  inputId,
  onReplace,
  onRemove,
}: {
  screenshot: UploadedScreenshot;
  inputId: string;
  onReplace: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[#DCE9EA] bg-white p-3">
      <div className="relative h-16 w-20 overflow-hidden rounded-xl border border-[#DCE9EA] bg-[#E8F0F1] shrink-0">
        {screenshot.objectUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={screenshot.objectUrl}
            alt={`Preview of ${screenshot.filename}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] font-semibold text-[#8aa0a3]">
            Design preview
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#063f46]">{screenshot.filename}</p>
        <p className="text-xs text-[#4a6366]">
          {screenshot.sizeBytes > 0 ? 'Ready on this device' : 'Design-preview placeholder'}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onReplace}
          className="text-sm font-medium text-[#075B5C] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1]/60 rounded"
        >
          Replace
        </button>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove screenshot"
            className="text-sm font-medium text-[#9a3412] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1]/60 rounded"
          >
            Remove
          </button>
        ) : null}
      </div>
      <label htmlFor={inputId} className="sr-only">
        Replace screenshot
      </label>
    </div>
  );
}
