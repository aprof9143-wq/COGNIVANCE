/** Small form controls for the neurodegeneration module (inherit the .ws styles). */

export function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label
      className={`flex flex-col gap-1 text-[12px] text-[#aab6c8] ${wide ? "sm:col-span-2" : ""}`}
    >
      {label}
      {children}
    </label>
  );
}

export function Text({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      className="field"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** A number input whose empty state is null — never silently 0. */
export function Num({
  value,
  onChange,
  step,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
}) {
  return (
    <input
      className="field"
      type="number"
      step={step ?? "any"}
      value={value ?? ""}
      placeholder="not recorded"
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly (T | [T, string])[];
}) {
  return (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return (
          <option key={v} value={v}>
            {l}
          </option>
        );
      })}
    </select>
  );
}

export function DateInput({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <input
      className="field"
      type="date"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Visual state for a value that is not a number. */
export function Missing({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-dashed border-[#4a5566] px-1.5 py-px text-[11px] text-[#aab6c8]">
      {children}
    </span>
  );
}
