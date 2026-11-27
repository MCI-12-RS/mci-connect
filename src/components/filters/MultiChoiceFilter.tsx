import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FILTER_TEXTS } from "@/lib/filters/texts";
import { cn } from "@/lib/utils";
import { FILTER_LABEL_CLASS, type FilterOption } from "./filter-options";

interface MultiChoiceFilterProps<T extends string> {
  legend: string;
  options: readonly FilterOption<T>[];
  /** Os valores escolhidos, na ordem das opções. */
  values: readonly T[];
  onChange: (values: T[]) => void;
  /** Caixas à vista no `Sheet`, ou um botão que abre as mesmas caixas num `Popover` no computador (P51). */
  variant: "checkboxes" | "popover";
  /** Dica do grupo, ligada ao `fieldset`. */
  groupHint?: string;
  /** A dica do grupo antes das opções que ela explica (Vínculo celular) ou depois (Nível). */
  groupHintPosition?: "before" | "after";
}

interface ChoiceListProps<T extends string> extends Omit<MultiChoiceFilterProps<T>, "variant"> {
  baseId: string;
  /** Uma opção por linha (no `Popover`). */
  stacked: boolean;
  legendSrOnly: boolean;
}

function ChoiceList<T extends string>({
  baseId,
  legend,
  options,
  values,
  onChange,
  groupHint,
  groupHintPosition = "after",
  stacked,
  legendSrOnly,
}: ChoiceListProps<T>) {
  const groupHintId = `${baseId}-hint`;
  const toggle = (value: T, checked: boolean) => {
    const chosen = new Set(values);
    if (checked) chosen.add(value);
    else chosen.delete(value);
    onChange(options.filter((option) => chosen.has(option.value)).map((option) => option.value));
  };
  const hint = groupHint && (
    <p id={groupHintId} className="text-sm text-muted-foreground">
      {groupHint}
    </p>
  );
  return (
    <fieldset className="min-w-0 space-y-2" aria-describedby={groupHint ? groupHintId : undefined}>
      <legend className={legendSrOnly ? "sr-only" : "text-sm font-medium"}>{legend}</legend>
      {groupHintPosition === "before" && hint}
      <div className={cn(stacked ? "flex flex-col gap-1" : "flex flex-wrap gap-x-4 gap-y-1")}>
        {options.map((option) => {
          const itemId = `${baseId}-${option.value}`;
          const hintId = `${itemId}-hint`;
          const checkbox = (
            <Checkbox
              id={itemId}
              checked={values.includes(option.value)}
              onCheckedChange={(checked) => toggle(option.value, checked === true)}
              aria-describedby={option.hint ? hintId : undefined}
            />
          );
          if (!option.hint) {
            return (
              <Label
                key={option.value}
                htmlFor={itemId}
                className={cn("flex min-h-11 min-w-0 cursor-pointer items-center gap-2 font-normal", stacked && "w-full")}
              >
                {checkbox}
                <span className="min-w-0 break-words">{option.label}</span>
              </Label>
            );
          }
          return (
            <div key={option.value} className="w-full min-w-0">
              <Label htmlFor={itemId} className="flex min-h-11 w-full cursor-pointer items-center gap-2 font-normal">
                {checkbox}
                <span className="min-w-0 break-words">{option.label}</span>
              </Label>
              <p id={hintId} className="-mt-1 pb-1 pl-6 text-sm text-muted-foreground">
                {option.hint}
              </p>
            </div>
          );
        })}
      </div>
      {groupHintPosition === "after" && hint}
    </fieldset>
  );
}

/**
 * Filtro de múltipla escolha (E2.07, P51): um `fieldset` com uma caixa por opção, de 44 px e a linha
 * inteira clicável. No computador, a mesma lista num `Popover`, aberto por um botão com a aparência
 * do `SelectTrigger`, que mostra "Todos" ou as opções escolhidas, com quebra de linha.
 */
export function MultiChoiceFilter<T extends string>({ variant, ...props }: MultiChoiceFilterProps<T>) {
  const baseId = useId();
  const [open, setOpen] = useState(false);
  if (variant === "checkboxes") return <ChoiceList {...props} baseId={baseId} stacked={false} legendSrOnly={false} />;

  const labelId = `${baseId}-label`;
  const buttonId = `${baseId}-button`;
  const chosen = props.options.filter((option) => props.values.includes(option.value)).map((option) => option.label);
  return (
    <fieldset className="min-w-0">
      <legend id={labelId} className={FILTER_LABEL_CLASS}>
        {props.legend}
      </legend>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={buttonId}
            type="button"
            variant="outline"
            aria-haspopup="dialog"
            aria-labelledby={`${labelId} ${buttonId}`}
            className="h-auto min-h-10 w-full justify-between gap-2 whitespace-normal px-3 py-2 text-left font-normal"
          >
            <span className="min-w-0 break-words">{chosen.length > 0 ? chosen.join(", ") : FILTER_TEXTS.all}</span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="max-h-[var(--radix-popover-content-available-height)] w-72 overflow-y-auto p-3 motion-reduce:animate-none"
        >
          <ChoiceList {...props} baseId={`${baseId}-popover`} stacked legendSrOnly />
        </PopoverContent>
      </Popover>
    </fieldset>
  );
}
