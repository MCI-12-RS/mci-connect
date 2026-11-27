import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EMPTY_AUDIT_FILTERS, isPeriodInverted, type AuditFilters } from "@/lib/audit/url-params";
import { AUDIT_TEXTS } from "@/lib/audit/texts";
import { SHEET_HIDE_DEFAULT_CLOSE, SheetCloseButton } from "@/components/SheetCloseButton";
import { cn } from "@/lib/utils";
import { FilterSelects } from "./FilterSelects";
import { PeriodFieldset } from "./PeriodFieldset";

interface AuditFiltersSheetProps {
  open: boolean;
  filters: AuditFilters;
  historyMode: boolean;
  today: string;
  onApply: (filters: AuditFilters) => void;
  onClose: () => void;
  /** Devolve o foco ao botão "Filtros". */
  onCloseAutoFocus: (event: Event) => void;
}

const FILTERS = AUDIT_TEXTS.filters;

/**
 * Os filtros no celular (E2.05, T8): um painel de baixo para cima, que abre com os filtros em vigor e
 * só aplica em "Aplicar filtros" (que confere o período). "✕", `Esc` e o toque fora fecham sem aplicar;
 * "Limpar" volta os campos do painel ao padrão, sem aplicar.
 */
export function AuditFiltersSheet({ open, filters, historyMode, today, onApply, onClose, onCloseAutoFocus }: AuditFiltersSheetProps) {
  const [draft, setDraft] = useState<AuditFilters>(filters);
  const [periodInvalid, setPeriodInvalid] = useState(false);
  const toRef = useRef<HTMLInputElement>(null);

  // Abre sempre com os filtros em vigor; com o painel aberto, o rascunho não é reescrito.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(filters);
      setPeriodInvalid(false);
    }
  }

  const change = (changes: Partial<AuditFilters>) => {
    setDraft((current) => ({ ...current, ...changes }));
    if ("from" in changes || "to" in changes) setPeriodInvalid(false);
  };

  const apply = () => {
    if (isPeriodInverted(draft.from, draft.to)) {
      setPeriodInvalid(true);
      toRef.current?.focus();
      return;
    }
    onApply(draft);
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        className={cn("flex max-h-[90dvh] flex-col gap-0 p-0 motion-reduce:animate-none", SHEET_HIDE_DEFAULT_CLOSE)}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <SheetCloseButton label={AUDIT_TEXTS.sheet.close} />
        <SheetHeader className="border-b p-4 pr-14 text-left">
          <SheetTitle>{FILTERS.sheetTitle}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <FilterSelects filters={draft} historyMode={historyMode} onChange={change} />
          <PeriodFieldset
            from={draft.from ?? ""}
            to={draft.to ?? ""}
            today={today}
            invalid={periodInvalid}
            onFromChange={(value) => change({ from: value || null })}
            onToChange={(value) => change({ to: value || null })}
            toRef={toRef}
          />
        </div>
        <div className="flex gap-2 border-t p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button type="button" variant="outline" className="h-11 flex-1" onClick={() => change({ ...EMPTY_AUDIT_FILTERS })}>
            {FILTERS.clear}
          </Button>
          <Button type="button" className="h-11 flex-1" onClick={apply}>
            {FILTERS.apply}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
