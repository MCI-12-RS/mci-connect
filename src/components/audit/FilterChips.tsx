import { useRef, type RefObject } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FilterChip } from "@/lib/audit/url-params";
import { AUDIT_TEXTS } from "@/lib/audit/texts";

interface FilterChipsProps {
  chips: FilterChip[];
  onRemove: (key: FilterChip["key"]) => void;
  onClearAll: () => void;
  /** O botão "Filtros": recebe o foco quando o último chip sai (T8). */
  filtersButtonRef: RefObject<HTMLButtonElement>;
}

/**
 * Os filtros ativos como chips removíveis (E2.05, T8), com "Limpar filtros". Depois de remover um chip,
 * o foco vai para o próximo ou, se não houver, para "Filtros".
 */
export function FilterChips({ chips, onRemove, onClearAll, filtersButtonRef }: FilterChipsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  if (chips.length === 0) return null;

  const remove = (index: number) => {
    const nextKey = chips[index + 1]?.key ?? chips[index - 1]?.key ?? null;
    onRemove(chips[index].key);
    // Depois de a URL mudar e a lista de chips ser refeita.
    requestAnimationFrame(() => {
      const next = nextKey ? listRef.current?.querySelector<HTMLButtonElement>(`button[data-chip="${nextKey}"]`) : null;
      (next ?? filtersButtonRef.current)?.focus();
    });
  };

  return (
    <div ref={listRef} className="flex flex-wrap items-center gap-2" data-testid="filter-chips">
      {chips.map((chip, index) => (
        <button
          key={chip.key}
          type="button"
          data-chip={chip.key}
          className="inline-flex h-11 items-center gap-1 rounded-full border bg-muted px-3 text-sm text-foreground md:h-9 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={AUDIT_TEXTS.chips.remove(chip.text)}
          onClick={() => remove(index)}
        >
          <span className="break-words">{chip.text}</span>
          <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </button>
      ))}
      <Button type="button" variant="ghost" className="h-11 md:h-9" onClick={onClearAll}>
        {AUDIT_TEXTS.filters.clearAll}
      </Button>
    </div>
  );
}
