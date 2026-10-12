/** A labelled range input with its value. A top-level component on purpose: one
 *  declared inside a render function would remount on every change and drop the drag. */
export function Slider({ label, value, onChange, min, max, step, disabled }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; disabled?: boolean;
}) {
  return (
    <label className="row slider">
      <span className="slider-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={e => onChange(+e.target.value)} />
      <output>{value.toFixed(2)}</output>
    </label>
  );
}
