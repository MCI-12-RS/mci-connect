import { useId, type FocusEvent, type Ref } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface DateRangeFilterProps {
  /** A legenda do grupo ("Período", "Data de cadastro"). */
  legend: string;
  /** A legenda só para o leitor de tela (P54). */
  legendSrOnly?: boolean;
  fromLabel: string;
  toLabel: string;
  /** "aaaa-mm-dd". */
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  /** Data máxima dos dois campos (P33). Sem ela, datas futuras valem (P54). */
  max?: string;
  /** Dica embaixo dos dois campos, ligada aos dois (P54). */
  hint?: string;
  /** "Até" antes de "De": esta mensagem embaixo de "Até". */
  invertedMessage?: string | null;
  /** Erro de cada campo (data que não existe, P54), embaixo dele. */
  fromError?: string | null;
  toError?: string | null;
  onFromBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  onToBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  fromRef?: Ref<HTMLInputElement>;
  toRef?: Ref<HTMLInputElement>;
  /** Os campos lado a lado (computador) ou um embaixo do outro (painel do celular). */
  inline?: boolean;
  /** Rótulos dos campos menores, como na Auditoria. */
  smallLabels?: boolean;
}

const ids = (...values: (string | null | false | undefined)[]): string | undefined =>
  values.filter(Boolean).join(" ") || undefined;

/**
 * Filtro por intervalo de datas (E2.05, P33; E2.07, P54): dois campos de data nativos num `fieldset`,
 * opcionais e com os dois dias incluídos. A conferência fica com quem usa: este componente só mostra
 * as mensagens que recebe. Os campos rolam com folga embaixo (`scroll-mb-24`): no celular, o erro e
 * a dica não ficam atrás do rodapé fixo da folha.
 */
export function DateRangeFilter({
  legend,
  legendSrOnly = false,
  fromLabel,
  toLabel,
  from,
  to,
  onFromChange,
  onToChange,
  max,
  hint,
  invertedMessage,
  fromError,
  toError,
  onFromBlur,
  onToBlur,
  fromRef,
  toRef,
  inline = false,
  smallLabels = false,
}: DateRangeFilterProps) {
  const fromId = useId();
  const toId = useId();
  const fromErrorId = useId();
  const toErrorId = useId();
  const hintId = useId();
  const toMessage = toError ?? invertedMessage ?? null;
  return (
    <fieldset className="min-w-0 space-y-1">
      <legend className={legendSrOnly ? "sr-only" : "text-sm font-medium"}>{legend}</legend>
      <div className={cn("grid gap-2", inline ? "grid-cols-2" : "grid-cols-1", legendSrOnly && "!mt-0")}>
        <div className="min-w-0 space-y-1">
          <Label htmlFor={fromId} className={smallLabels ? "text-xs" : "block leading-5"}>
            {fromLabel}
          </Label>
          <Input
            id={fromId}
            ref={fromRef}
            type="date"
            max={max}
            value={from}
            onChange={(e) => onFromChange(e.target.value)}
            onBlur={onFromBlur}
            aria-invalid={fromError ? true : undefined}
            aria-describedby={ids(fromError && fromErrorId, hint && hintId)}
            className="h-11 scroll-mb-24 lg:h-10"
          />
          {fromError && (
            <p id={fromErrorId} className="text-sm font-medium text-destructive">
              {fromError}
            </p>
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor={toId} className={smallLabels ? "text-xs" : "block leading-5"}>
            {toLabel}
          </Label>
          <Input
            id={toId}
            ref={toRef}
            type="date"
            max={max}
            value={to}
            onChange={(e) => onToChange(e.target.value)}
            onBlur={onToBlur}
            aria-invalid={toMessage ? true : undefined}
            aria-describedby={ids(toMessage && toErrorId, hint && hintId)}
            className="h-11 scroll-mb-24 lg:h-10"
          />
          {toMessage && !inline && (
            <p id={toErrorId} className="text-sm font-medium text-destructive">
              {toMessage}
            </p>
          )}
        </div>
      </div>
      {toMessage && inline && (
        <p id={toErrorId} className="text-sm font-medium text-destructive">
          {toMessage}
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </fieldset>
  );
}
