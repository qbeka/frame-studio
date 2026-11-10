import { useEffect, useId, useState } from 'react';

/**
 * A numeric input that keeps what you are typing, even when it is not valid yet. Only a finite
 * value inside the range reaches the project. Anything else shows an error and changes nothing.
 */
export function NumberField({
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const parsed = Number(text);
  const valid = text.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max;

  useEffect(() => {
    setText((current) => (Number(current) === value ? current : String(value)));
  }, [value]);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="number">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={text}
          min={min}
          max={max}
          step={step}
          aria-invalid={!valid}
          aria-describedby={valid ? undefined : `${id}-error`}
          onChange={(event) => {
            setText(event.target.value);
            const next = Number(event.target.value);
            if (event.target.value.trim() !== '' && Number.isFinite(next) && next >= min && next <= max) onChange(next);
          }}
          onBlur={() => {
            if (!valid) setText(String(value));
          }}
        />
        <span className="unit">{unit}</span>
      </div>
      {valid ? null : (
        <p className="field-error" id={`${id}-error`}>
          Use {min} to {max}
        </p>
      )}
    </div>
  );
}
