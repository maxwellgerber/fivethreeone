import { fmtW } from '../format.ts';

export function Stepper({ value, label, step, onChange, min = 0 }: { value: number; label: string; step: number; onChange: (v: number) => void; min?: number }) {
  const bump = (dir: 1 | -1) => onChange(Math.max(min, +(value + dir * step).toFixed(2)));
  return (
    <div className="stepper">
      <button type="button" aria-label="decrease" onClick={() => bump(-1)}>−</button>
      <div className="val"><span>{fmtW(value)}</span><small>{label}</small></div>
      <button type="button" aria-label="increase" onClick={() => bump(1)}>+</button>
    </div>
  );
}
