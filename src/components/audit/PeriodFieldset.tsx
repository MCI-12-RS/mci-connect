import { useId, type Ref } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUDIT_TEXTS } from "@/lib/audit/texts";
import { cn } from "@/lib/utils";

interface PeriodFieldsetProps {
  from: string;
  to: string;
  /** Hoje em Brasília ("aaaa-mm-dd"): o `max` dos dois campos (P33). */
  today: string;
  /** "Até" antes de "De" (P33): o erro embaixo de "Até". */
  invalid: boolean;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  toRef?: Ref<HTMLInputElement>;
  /** Os campos lado a lado (computador) ou um embaixo do outro (painel do celular). */
  inline?: boolean;
}

const FILTERS = AUDIT_TEXTS.filters;

/**
 * O filtro de período (E2.05, P33): "De" e "Até", campos de data nativos num `fieldset` "Período", com
 * `max` igual a hoje. Os dois são opcionais e incluem o dia informado.
 */
export function PeriodFieldset({ from, to, today, invalid, onFromChange, onToChange, toRef, inline = false }: PeriodFieldsetProps) {
  const fromId = useId();
  const toId = useId();
  const errorId = useId();
  return (
    <fieldset className="min-w-0 space-y-1">
      <legend className="text-sm font-medium">{FILTERS.period}</legend>
      <div className={cn("grid gap-2", inline ? "grid-cols-2" : "grid-cols-1")}>
        <div className="space-y-1">
          <Label htmlFor={fromId} className="text-xs">
            {FILTERS.from}
          </Label>
          <Input id={fromId} type="date" max={today} value={from} onChange={(e) => onFromChange(e.target.value)} className="h-11 md:h-10" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={toId} className="text-xs">
            {FILTERS.to}
          </Label>
          <Input
            id={toId}
            ref={toRef}
            type="date"
            max={today}
            value={to}
            onChange={(e) => onToChange(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            className="h-11 md:h-10"
          />
        </div>
      </div>
      {invalid && (
        <p id={errorId} className="text-sm font-medium text-destructive">
          {FILTERS.periodInvalid}
        </p>
      )}
    </fieldset>
  );
}
