import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { activeFilterCount, isPeriodInverted, type AuditFilters as Filters } from "@/lib/audit/url-params";
import { AUDIT_TEXTS } from "@/lib/audit/texts";
import { FilterSelects } from "./FilterSelects";
import { PeriodFieldset } from "./PeriodFieldset";

interface AuditFiltersProps {
  /** O campo de busca, na primeira linha, ao lado do período. */
  search: ReactNode;
  filters: Filters;
  historyMode: boolean;
  today: string;
  onChange: (changes: Partial<Filters>) => void;
  onClearAll: () => void;
}

/**
 * Os filtros a partir de 768 px (E2.05, T7): acima da lista, valendo na hora. O período inválido ("Até"
 * antes de "De") mostra o erro e não consulta o servidor (P33).
 */
export function AuditFilters({ search, filters, historyMode, today, onChange, onClearAll }: AuditFiltersProps) {
  const [from, setFrom] = useState(filters.from ?? "");
  const [to, setTo] = useState(filters.to ?? "");

  // A URL mudou por fora (chip, "Limpar filtros", voltar): os campos acompanham.
  useEffect(() => setFrom(filters.from ?? ""), [filters.from]);
  useEffect(() => setTo(filters.to ?? ""), [filters.to]);

  const invalid = isPeriodInverted(from || null, to || null);
  const changePeriod = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
    if (!isPeriodInverted(nextFrom || null, nextTo || null)) onChange({ from: nextFrom || null, to: nextTo || null });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {search}
        <PeriodFieldset
          from={from}
          to={to}
          today={today}
          invalid={invalid}
          inline
          onFromChange={(value) => changePeriod(value, to)}
          onToChange={(value) => changePeriod(from, value)}
        />
      </div>
      <div className="grid grid-cols-4 gap-3">
        <FilterSelects filters={filters} historyMode={historyMode} onChange={onChange} />
        {activeFilterCount(filters) > 0 && (
          <div className="col-start-4 flex items-end justify-end">
            <Button type="button" variant="ghost" className="h-10" onClick={onClearAll}>
              {AUDIT_TEXTS.filters.clearAll}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
