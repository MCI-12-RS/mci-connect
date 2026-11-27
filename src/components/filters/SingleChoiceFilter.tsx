import { useId } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FILTER_TEXTS } from "@/lib/filters/texts";
import { FILTER_LABEL_CLASS, type FilterOption } from "./filter-options";

interface SingleChoiceFilterProps<T extends string> {
  legend: string;
  /** As opções além de "Todos" (o padrão, que não conta como filtro). */
  options: readonly FilterOption<T>[];
  /** `null`: "Todos". */
  value: T | null;
  onChange: (value: T | null) => void;
  /** Opções lado a lado no `Sheet` ou `Select` no painel do computador (P52). */
  variant: "radio" | "select";
  /** O texto do padrão ("Todas" na Situação das células). Padrão: "Todos". */
  allLabel?: string;
}

/** O valor de "Todos" no controle: o Radix não aceita valor vazio. */
const ALL = "__all__";

/**
 * Filtro de escolha única com até 3 opções (E2.07, P52): `RadioGroup` com as opções lado a lado no
 * `Sheet` (1 toque) e `Select` no painel do computador. "Todos" vem primeiro e é o padrão.
 */
export function SingleChoiceFilter<T extends string>({
  legend,
  options,
  value,
  onChange,
  variant,
  allLabel = FILTER_TEXTS.all,
}: SingleChoiceFilterProps<T>) {
  const baseId = useId();
  const legendId = `${baseId}-legend`;
  const toValue = (raw: string): T | null => options.find((option) => option.value === raw)?.value ?? null;
  const all: FilterOption<string> = { value: ALL, label: allLabel };
  const choices: readonly FilterOption<string>[] = [all, ...options];

  if (variant === "select") {
    const triggerId = `${baseId}-trigger`;
    return (
      <fieldset className="min-w-0">
        <legend id={legendId} className={FILTER_LABEL_CLASS}>
          {legend}
        </legend>
        <Select value={value ?? ALL} onValueChange={(raw) => onChange(toValue(raw))}>
          <SelectTrigger id={triggerId} aria-labelledby={`${legendId} ${triggerId}`} className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </fieldset>
    );
  }

  return (
    <fieldset className="min-w-0 space-y-2">
      <legend id={legendId} className="text-sm font-medium">
        {legend}
      </legend>
      <RadioGroup
        aria-labelledby={legendId}
        value={value ?? ALL}
        onValueChange={(raw) => onChange(toValue(raw))}
        className="grid grid-cols-3 gap-2"
      >
        {choices.map((choice) => {
          const itemId = `${baseId}-${choice.value}`;
          return (
            <Label
              key={choice.value}
              htmlFor={itemId}
              className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 font-normal"
            >
              <RadioGroupItem id={itemId} value={choice.value} />
              <span className="min-w-0 break-words">{choice.label}</span>
            </Label>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}
