import { useId } from "react";
import { Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { PaginatedSelect } from "@/components/select/PaginatedSelect";
import { toMemberOption, useMemberOptions } from "@/hooks/use-member-options";
import { useOptionsPagination, useSelectSearch } from "@/hooks/use-paginated-select";
import type { SelectOption } from "@/lib/selectors";
import { FILTER_LABEL_CLASS } from "./filter-options";

export interface PersonMultiFilterTexts {
  label: string;
  placeholder: string;
  hint: string;
  /** Com o limite atingido, no lugar da dica (`role="status"`). */
  limit: string;
  /** Embaixo da dica, quando há pessoa indisponível. */
  unavailable: (count: number) => string;
}

interface PersonMultiFilterProps {
  texts: PersonMultiFilterTexts;
  /**
   * As pessoas escolhidas, na ordem da escolha, já com o rótulo: o nome lido entre as pessoas
   * visíveis, "Pessoa indisponível" ou "Carregando…" (P53). Nunca um nome da `member_names`.
   */
  value: readonly SelectOption[];
  /** As pessoas escolhidas, na ordem, com o nome que veio da opção. */
  onChange: (options: SelectOption[]) => void;
  /** Quantas das escolhidas estão indisponíveis. */
  unavailableCount: number;
  /** A busca sem resultado (P11). */
  noResultsLabel: string;
  /** Limite de pessoas (RN-04). */
  max: number;
}

/**
 * Pessoa como filtro (E2.07, P53): o `PaginatedSelect` múltiplo com as pessoas visíveis, ativas e
 * inativas (inclusive quem consulta), com um limite que desabilita as outras opções. Sem a prop
 * `name` do react-select, que criaria um campo escondido com os ids no DOM (UX-09).
 */
export function PersonMultiFilter({ texts, value, onChange, unavailableCount, noResultsLabel, max }: PersonMultiFilterProps) {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const hintId = `${baseId}-hint`;
  const unavailableId = `${baseId}-unavailable`;
  const search = useSelectSearch();
  const query = useMemberOptions({ search: search.term, enabled: search.isMenuOpen });
  const pagination = useOptionsPagination(query, toMemberOption);
  const limitReached = value.length >= max;
  const describedBy = [hintId, unavailableCount > 0 ? unavailableId : null].filter(Boolean).join(" ");

  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={inputId} className={FILTER_LABEL_CLASS}>
        {texts.label}
      </Label>
      <PaginatedSelect
        inputId={inputId}
        isMulti
        search={search}
        pagination={pagination}
        value={value}
        onChange={(next) => onChange(next.slice(0, max))}
        placeholder={texts.placeholder}
        noResultsLabel={noResultsLabel}
        maxSelected={max}
        aria-describedby={describedBy}
      />
      {/* Uma região só: com o limite, a mensagem dele no lugar da dica, anunciada (P53). */}
      <p id={hintId} role="status" className="text-sm text-muted-foreground">
        {limitReached ? texts.limit : texts.hint}
      </p>
      {unavailableCount > 0 && (
        <p id={unavailableId} className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{texts.unavailable(unavailableCount)}</span>
        </p>
      )}
    </div>
  );
}
