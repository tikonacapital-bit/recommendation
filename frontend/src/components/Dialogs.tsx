import { useState, useEffect, useRef } from 'react';

interface PromptDialogProps {
  title: string;
  message?: string;
  placeholder?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({ title, message, placeholder, confirmLabel = 'Create', onConfirm, onCancel }: PromptDialogProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = () => {
    if (!value.trim()) return;
    onConfirm(value.trim());
  };

  return (
    <div className="fixed inset-0 z-50 backdrop-blur-md bg-slate-950/80 flex items-center justify-center p-4">
      <div className="bg-[#0b121f] border border-white/[0.08] rounded-2xl w-full max-w-sm shadow-2xl">
        <form
          onSubmit={e => { e.preventDefault(); submit(); }}
          className="p-5 space-y-4"
        >
          <div>
            <h2 className="text-sm font-bold text-slate-100">{title}</h2>
            {message && <p className="text-xs text-slate-500 mt-1">{message}</p>}
          </div>
          <input
            ref={inputRef}
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-all cursor-pointer"
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 backdrop-blur-md bg-slate-950/80 flex items-center justify-center p-4">
      <div className="bg-[#0b121f] border border-white/[0.08] rounded-2xl w-full max-w-sm shadow-2xl p-5 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-slate-100">{title}</h2>
          {message && <p className="text-xs text-slate-500 mt-1">{message}</p>}
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all cursor-pointer ${
              danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-indigo-600 hover:bg-indigo-500'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
