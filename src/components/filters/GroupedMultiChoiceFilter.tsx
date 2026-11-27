import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FILTER_LABEL_CLASS, type FilterOption } from "./filter-options";
import { ChoiceList } from "./MultiChoiceFilter";

/** Um subgrupo de opções (P85): a legenda e as opções, que podem ser curtas. */
export interface FilterOptionGroup<T extends string> {
  legend: string;
  options: readonly FilterOption<T>[];
}

interface GroupedMultiChoiceFilterProps<T extends string> {
  legend: string;
  groups: readonly FilterOptionGroup<T>[];
  /** Os valores escolhidos, na ordem das opções (de todos os subgrupos). */
  values: readonly T[];
  onChange: (values: T[]) => void;
  /** Caixas à vista no `Sheet`, ou um botão que abre as mesmas caixas num `Popover` no computador (P51). */
  variant: "checkboxes" | "popover";
  /** Dica do filtro, logo abaixo da legenda e ligada ao `fieldset` de fora. */
  hint?: string;
  /** O texto inteiro de cada opção, no botão do `Popover` (P85): "Sem relatório na semana passada". */
  fullLabel: (value: T) => string;
  /** O botão sem nada escolhido ("Todas"). */
  allLabel: string;
}

interface GroupsProps<T extends string> extends Omit<GroupedMultiChoiceFilterProps<T>, "variant" | "fullLabel" | "allLabel"> {
  baseId: string;
  stacked: boolean;
  legendSrOnly: boolean;
}

function Groups<T extends string>({ baseId, legend, groups, values, onChange, hint, stacked, legendSrOnly }: GroupsProps<T>) {
  const hintId = `${baseId}-hint`;
  const allOptions = groups.flatMap((group) => group.options);
  // Uma mudança num subgrupo troca só os valores dele; o resto fica, na ordem das opções.
  const changeGroup = (group: FilterOptionGroup<T>, groupValues: T[]) => {
    const inGroup = (value: T) => group.options.some((option) => option.value === value);
    onChange(
      allOptions
        .map((option) => option.value)
        .filter((value) => (inGroup(value) ? groupValues.includes(value) : values.includes(value))),
    );
  };
  return (
    <fieldset className="min-w-0 space-y-3" aria-describedby={hint ? hintId : undefined}>
      <legend className={legendSrOnly ? "sr-only" : "text-sm font-medium"}>{legend}</legend>
      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {groups.map((group, index) => (
        <ChoiceList
          key={group.legend}
          baseId={`${baseId}-${index}`}
          legend={group.legend}
          options={group.options}
          values={values.filter((value) => group.options.some((option) => option.value === value))}
          onChange={(groupValues) => changeGroup(group, groupValues)}
          stacked={stacked}
          legendSrOnly={false}
          subgroup
        />
      ))}
    </fieldset>
  );
}

/**
 * Múltipla escolha em subgrupos (E2.10, P85): um `fieldset` com a legenda do filtro e a dica, e um
 * `fieldset` com legenda para cada subgrupo. No computador, o mesmo conteúdo num `Popover`, aberto
 * por um botão com a aparência do `SelectTrigger`, que mostra os textos inteiros ou "Todas".
 */
export function GroupedMultiChoiceFilter<T extends string>({
  variant,
  fullLabel,
  allLabel,
  ...props
}: GroupedMultiChoiceFilterProps<T>) {
  const baseId = useId();
  const [open, setOpen] = useState(false);
  if (variant === "checkboxes") return <Groups {...props} baseId={baseId} stacked={false} legendSrOnly={false} />;

  const labelId = `${baseId}-label`;
  const buttonId = `${baseId}-button`;
  const chosen = props.groups
    .flatMap((group) => group.options)
    .filter((option) => props.values.includes(option.value))
    .map((option) => fullLabel(option.value));
  return (
    <div className="min-w-0">
      <span id={labelId} className={FILTER_LABEL_CLASS}>
        {props.legend}
      </span>
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
            <span className="min-w-0 break-words">{chosen.length > 0 ? chosen.join(", ") : allLabel}</span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="max-h-[var(--radix-popover-content-available-height)] w-80 overflow-y-auto p-3 motion-reduce:animate-none"
        >
          <Groups {...props} baseId={`${baseId}-popover`} stacked legendSrOnly />
        </PopoverContent>
      </Popover>
      {props.hint && <p className="mt-1 text-sm text-muted-foreground">{props.hint}</p>}
    </div>
  );
}
