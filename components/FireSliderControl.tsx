type FireSliderControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
};

export type NumericSliderDef<TSection extends Record<string, number>> = {
  key: keyof TSection & string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
};

function formatValue(value: number, unit = '') {
  const precision = Number.isInteger(value) ? 0 : value < 0.01 ? 4 : 2;
  return `${Number(value.toFixed(precision))}${unit ? ` ${unit}` : ''}`;
}

export default function FireSliderControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: FireSliderControlProps) {
  return (
    <label className="settingsPanel__fireControl">
      <span>
        <strong>{label}</strong>
        <output>{formatValue(value, unit)}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
      />
    </label>
  );
}
