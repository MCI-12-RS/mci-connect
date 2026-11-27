import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export interface WeekShortcutItem {
  key: string;
  /** "Esta semana". */
  label: string;
  /** "Esta semana, de 22/11/2026 a 28/11/2026"; sem as datas do servidor, só o rótulo. */
  spokenLabel: string;
}

interface WeekShortcutsProps {
  /** O nome do grupo ("Atalhos de semana"). */
  groupLabel: string;
  items: readonly WeekShortcutItem[];
  /** O atalho marcado (o Período aplicado é exatamente o dele), ou nenhum. */
  value: string | null;
  /** Esperando a data do servidor: desabilitados, no mesmo lugar e com a mesma altura (UXD-4). */
  disabled: boolean;
  onSelect: (key: string) => void;
}

/**
 * Atalhos de período fora do painel de filtros (P90, E2.12): um grupo de escolha única, à vista em
 * todas as larguras, que vale na hora. O marcado é preenchido (não só pela cor) e tem `aria-checked`.
 * Tocar de novo no marcado não o desmarca (UXD-3). A grade se ajusta à largura, com o texto
 * quebrando dentro do botão de pelo menos 44 px.
 */
export function WeekShortcuts({ groupLabel, items, value, disabled, onSelect }: WeekShortcutsProps) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      aria-label={groupLabel}
      aria-busy={disabled || undefined}
      value={value ?? ""}
      onValueChange={(next) => {
        if (next) onSelect(next);
      }}
      disabled={disabled}
      className="grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] items-stretch justify-stretch gap-2 sm:flex sm:flex-wrap sm:justify-start"
    >
      {items.map((item) => (
        <ToggleGroupItem
          key={item.key}
          value={item.key}
          aria-label={item.spokenLabel}
          className="h-auto min-h-11 whitespace-normal px-2 py-1 text-sm font-normal leading-tight motion-reduce:transition-none data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:font-semibold data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90 data-[state=on]:hover:text-primary-foreground sm:px-3"
        >
          {item.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
