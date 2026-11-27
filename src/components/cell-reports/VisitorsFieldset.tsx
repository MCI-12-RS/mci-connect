import { useEffect, useRef, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldError, FieldHint } from "@/components/members/FormFieldParts";
import type { FocusTarget } from "@/hooks/use-report-form-state";
import { describedBy } from "@/lib/a11y";
import { REPORT_LIMITS } from "@/lib/cell-reports/limits";
import { REPORT_RULE_TEXTS, VISITORS_TEXTS } from "@/lib/cell-reports/texts";
import type { ReportFormField } from "@/lib/cell-reports/validation";
import { normalizeVisitorName, visitorsCount } from "@/lib/cell-reports/visitors";
import { cn } from "@/lib/utils";

export interface VisitorsFieldsetProps {
  names: string[];
  onChange: (names: string[]) => void;
  error?: string;
  disabled?: boolean;
  registerFocus: (field: ReportFormField, target: FocusTarget | null) => void;
}

/**
 * O grupo "Visitantes" (E2.11, T6, P102, RN-12): um campo por nome, com
 * "Adicionar visitante" e o botão de retirar em cada campo; Enter num campo
 * preenchido leva ao próximo ou abre um novo, e nunca envia o formulário.
 */
export function VisitorsFieldset({ names, onChange, error, disabled, registerFocus }: VisitorsFieldsetProps) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const addRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const atLimit = names.length >= REPORT_LIMITS.visitors;

  useEffect(() => {
    if (pendingFocus.current === null) return;
    const index = pendingFocus.current;
    pendingFocus.current = null;
    (inputs.current[index] ?? addRef.current)?.focus();
  });

  useEffect(() => {
    registerFocus("visitors", () => (inputs.current[0] ?? addRef.current)?.focus());
    return () => registerFocus("visitors", null);
  }, [registerFocus]);

  const setName = (index: number, value: string) => onChange(names.map((name, i) => (i === index ? value : name)));

  const add = () => {
    if (atLimit) return;
    pendingFocus.current = names.length;
    onChange([...names, ""]);
  };

  const remove = (index: number) => {
    const next = names.filter((_, i) => i !== index);
    // O foco vai para o campo seguinte, ou o anterior, ou "Adicionar visitante".
    pendingFocus.current = next.length === 0 ? -1 : Math.min(index, next.length - 1);
    onChange(next);
  };

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (normalizeVisitorName(names[index] ?? "") === "") return;
    if (index < names.length - 1) inputs.current[index + 1]?.focus();
    else add();
  };

  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="mb-3 text-base font-semibold">{VISITORS_TEXTS.legend}</legend>
      <FieldHint id="visitors-hint">{VISITORS_TEXTS.hint}</FieldHint>
      <ul className="space-y-2">
        {names.map((name, index) => {
          const trimmed = normalizeVisitorName(name);
          return (
            <li key={index} className="flex items-center gap-2">
              <Input
                ref={(element) => {
                  inputs.current[index] = element;
                }}
                value={name}
                onChange={(event) => setName(index, event.target.value)}
                onBlur={() => {
                  if (trimmed !== name) setName(index, trimmed);
                }}
                onKeyDown={onKeyDown(index)}
                placeholder={VISITORS_TEXTS.placeholder}
                aria-label={VISITORS_TEXTS.nameLabel(index + 1)}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy(error && "visitors-error", "visitors-hint")}
                autoComplete="off"
                autoCapitalize="words"
                enterKeyHint="next"
                disabled={disabled}
                className={cn("min-w-0 flex-1", error && "border-destructive")}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 shrink-0 md:h-9 md:w-9"
                onClick={() => remove(index)}
                disabled={disabled}
                aria-label={trimmed ? VISITORS_TEXTS.removeNamed(trimmed) : VISITORS_TEXTS.removeNth(index + 1)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
      {error && <FieldError id="visitors-error">{error}</FieldError>}
      <Button
        ref={addRef}
        type="button"
        variant="outline"
        className="h-11 w-full md:h-9 md:w-auto"
        onClick={add}
        disabled={disabled || atLimit}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {VISITORS_TEXTS.add}
      </Button>
      {atLimit && (
        <p role="status" className="text-sm text-foreground">
          {REPORT_RULE_TEXTS.too_many_visitors}
        </p>
      )}
      <p role="status" className="text-sm font-medium">
        {VISITORS_TEXTS.total(visitorsCount(names))}
      </p>
    </fieldset>
  );
}
