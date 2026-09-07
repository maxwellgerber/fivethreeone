import type { ReactNode } from 'react';

/** Label + control row used on the Program tab and in sheets. */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}{hint ? <span className="hint">{hint}</span> : null}</label>
      {children}
    </div>
  );
}

/** Numeric input that only commits parseable values. */
export function NumInput({ value, step = 1, onChange, ...rest }: { value: number; step?: number; onChange: (v: number) => void; id?: string; inputMode?: 'decimal' | 'numeric' }) {
  return (
    <input
      type="number"
      inputMode={rest.inputMode ?? 'decimal'}
      id={rest.id}
      step={step}
      defaultValue={value}
      key={value}
      onBlur={(e) => { const v = parseFloat(e.currentTarget.value); if (!Number.isNaN(v) && v !== value) onChange(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
    />
  );
}
