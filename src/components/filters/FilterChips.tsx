import { useRef, type RefObject } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FILTER_TEXTS } from "@/lib/filters/texts";
import type { FilterChip } from "@/lib/filters/chips";
import { cn } from "@/lib/utils";

export type { FilterChip };

interface FilterChipsProps<K extends string> {
  chips: readonly FilterChip<K>[];
  onRemove: (key: K) => void;
  /** O botão "Filtros": recebe o foco quando o último chip sai. */
  filtersButtonRef: RefObject<HTMLButtonElement>;
  /** "Limpar filtros" depois dos chips (Auditoria, E2.05). Membros o põe ao lado de "Filtros" (P50, UXD-6). */
  onClearAll?: () => void;
  /** O nome acessível do chip. Padrão: "Remover filtro {texto}". */
  removeLabel?: (text: string) => string;
  /** Chips de 36 px também no celular (P50). Padrão: 44 px no celular e 36 px a partir de 768 px (E2.05). */
  compact?: boolean;
}

/**
 * Os filtros ativos como chips removíveis (E2.05, T8; E2.07, P50). Depois de remover um chip, o foco
 * vai para o próximo ou, se não houver, para "Filtros".
 */
export function FilterChips<K extends string>({
  chips,
  onRemove,
  filtersButtonRef,
  onClearAll,
  removeLabel = FILTER_TEXTS.removeChip,
  compact = false,
}: FilterChipsProps<K>) {
  const listRef = useRef<HTMLDivElement>(null);
  if (chips.length === 0) return null;

  const remove = (index: number) => {
    const nextKey = chips[index + 1]?.key ?? chips[index - 1]?.key ?? null;
    onRemove(chips[index].key);
    // Depois de a URL mudar e a lista de chips ser refeita.
    requestAnimationFrame(() => {
      const next = nextKey
        ? listRef.current?.querySelector<HTMLButtonElement>(`button[data-chip="${CSS.escape(nextKey)}"]`)
        : null;
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
          className={cn(
            "inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border bg-muted px-3 text-left text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            compact ? "min-h-9 py-1" : "h-11 lg:h-9",
          )}
          aria-label={removeLabel(chip.text)}
          onClick={() => remove(index)}
        >
          <span className="min-w-0 break-words">{chip.text}</span>
          <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </button>
      ))}
      {onClearAll && (
        <Button type="button" variant="ghost" className="h-11 lg:h-9" onClick={onClearAll}>
          {FILTER_TEXTS.clearAll}
        </Button>
      )}
    </div>
  );
}
