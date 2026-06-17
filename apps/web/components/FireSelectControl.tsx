type FireSelectOption<TValue extends string> = {
  value: TValue;
  label: string;
};

type FireSelectControlProps<TValue extends string> = {
  label: string;
  value: TValue;
  valueLabel?: string;
  description?: string;
  options: FireSelectOption<TValue>[];
  onChange: (value: TValue) => void;
};

export default function FireSelectControl<TValue extends string>({
  label,
  value,
  valueLabel,
  description,
  options,
  onChange,
}: FireSelectControlProps<TValue>) {
  return (
    <label className="settingsPanel__fireControl">
      <span>
        <strong>{label}</strong>
        {valueLabel ? <output>{valueLabel}</output> : null}
      </span>
      <select
        value={value}
        onChange={event => onChange(event.target.value as TValue)}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {description ? <small>{description}</small> : null}
    </label>
  );
}
