import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";

interface FiltersPanelProps {
  /** O id do conteúdo, para o `aria-controls` do botão "Filtros". */
  id: string;
  open: boolean;
  children: ReactNode;
}

/**
 * Os filtros a partir de 1024 px (E2.07, P50; T3): um painel recolhível acima da lista, aberto e
 * fechado pelo botão "Filtros", em 4 colunas. Cada campo vale na hora.
 */
export function FiltersPanel({ id, open, children }: FiltersPanelProps) {
  return (
    <Collapsible open={open}>
      <CollapsibleContent id={id} className="pt-1">
        <div className="grid grid-cols-4 items-start gap-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
