import { AetherField } from "./AetherField";

type BrandFieldProps = {
  variant?: "ink" | "coral";
};

/** Charon field for branded pauses such as launch, loading, and empty states. */
export function BrandField({ variant = "ink" }: BrandFieldProps) {
  return (
    <div className={`brand-field brand-field-${variant}`} aria-hidden>
      <AetherField seed={variant === "coral" ? 17 : 29} />
      <span className="brand-field-moon" />
      <span className="brand-field-star" />
    </div>
  );
}
