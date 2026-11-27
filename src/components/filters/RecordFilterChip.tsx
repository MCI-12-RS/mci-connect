import type { ReactNode } from "react";
import { Info, X } from "lucide-react";
import { FILTER_TEXTS } from "@/lib/filters/texts";
import { recordFilterChipText, type RecordFilterChipState, type RecordFilterChipTexts } from "@/lib/filters/record-chip";

export type { RecordFilterChipState, RecordFilterChipTexts };

interface RecordFilterChipProps {
  state: RecordFilterChipState;
  texts: RecordFilterChipTexts;
  /** Tira o filtro; quem usa leva o foco adiante (a busca, em Relatórios). */
  onRemove: () => void;
  /** Ao lado do chip, na mesma linha que quebra ("Limpar filtros", T15). */
  trailing?: ReactNode;
}

/**
 * Filtro por um registro vindo de outra tela (E2.10, P84): um chip removível acima da lista, com o
 * registro identificado, "carregando" e "não carregado" enquanto a identificação não chega, ou
 * "indisponível" com uma dica, sem nome e sem id. Quebra a linha, sem cortar o texto.
 */
export function RecordFilterChip({ state, texts, onRemove, trailing }: RecordFilterChipProps) {
  const text = recordFilterChipText(state, texts);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex min-h-9 min-w-0 max-w-full items-center gap-1 rounded-full border bg-muted px-3 py-1 text-left text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={FILTER_TEXTS.removeChip(text)}
          onClick={onRemove}
        >
          <span className="min-w-0 break-words">{text}</span>
          <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </button>
        {trailing}
      </div>
      {state.kind === "unavailable" && (
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{texts.unavailableHint}</span>
        </p>
      )}
    </div>
  );
}
