import { forwardRef, type ClipboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError, FieldHint } from "@/components/members/FormFieldParts";
import { describedBy } from "@/lib/a11y";
import { maskTypedOffering, readPastedOffering } from "@/lib/cell-reports/offering";
import { OFFERING_TEXTS, REPORT_FORM_TEXTS } from "@/lib/cell-reports/texts";
import { cn } from "@/lib/utils";

interface OfferingInputProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

/**
 * A oferta em reais (E2.11, P101, UXD-9): os dígitos entram pelos centavos,
 * com o teclado numérico e "R$" fixo; o colado é lido como número pt-BR. Vazio
 * não é zero.
 */
export const OfferingInput = forwardRef<HTMLInputElement, OfferingInputProps>(({ value, onChange, error, disabled }, ref) => {
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const read = readPastedOffering(event.clipboardData.getData("text"));
    event.preventDefault();
    if (read !== null) onChange(read);
  };
  return (
    <div className="min-w-0 space-y-2 md:w-1/2">
      <Label htmlFor="report-offering">
        {OFFERING_TEXTS.label}
        {REPORT_FORM_TEXTS.required}
      </Label>
      <FieldHint id="report-offering-hint">{OFFERING_TEXTS.hint}</FieldHint>
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
        >
          {OFFERING_TEXTS.currency}
        </span>
        <Input
          id="report-offering"
          ref={ref}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="next"
          placeholder={OFFERING_TEXTS.placeholder}
          value={value}
          onChange={(event) => onChange(maskTypedOffering(event.target.value))}
          onPaste={onPaste}
          required
          disabled={disabled}
          className={cn("pl-10", error && "border-destructive")}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(error && "report-offering-error", "report-offering-hint")}
        />
      </div>
      {error && <FieldError id="report-offering-error">{error}</FieldError>}
    </div>
  );
});
OfferingInput.displayName = "OfferingInput";
