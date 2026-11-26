import { useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MissingWeeksLine, ReportStatusBadge } from "@/components/cells/ReportStatus";
import { REPORT_STATUS_LEGEND, reportStatusDisplay } from "@/lib/cells/report-status";
import { cn } from "@/lib/utils";

/**
 * P73: "Entenda a situação do relatório", uma legenda recolhível acima da
 * lista, e não dicas por badge (UXD-7). Começa fechada em toda visita e não
 * muda a URL. Dentro, uma `dl`: o mesmo badge da lista no `dt` e a explicação
 * no `dd`.
 */
const ReportStatusLegend = () => {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="h-auto min-h-11 justify-start gap-2 whitespace-normal px-2 py-2 text-left md:min-h-9">
          <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
          {REPORT_STATUS_LEGEND.toggle}
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")}
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 max-w-3xl rounded-md bg-muted/50 p-3 text-sm text-foreground">
        <dl className="md:grid md:grid-cols-[auto_1fr] md:items-start md:gap-x-4 md:gap-y-2">
          {REPORT_STATUS_LEGEND.statuses.map(({ status, explanation }) => {
            const display = reportStatusDisplay(status, true);
            return (
              <div key={status} className="contents">
                <dt className="mb-1 md:mb-0">{display.kind === "badge" && <ReportStatusBadge display={display} />}</dt>
                <dd className="mb-3 md:mb-0">{explanation}</dd>
              </div>
            );
          })}
          <div className="contents">
            <dt className="mb-1 md:mb-0">
              <MissingWeeksLine text={REPORT_STATUS_LEGEND.weeks.term} afterBadge={false} />
            </dt>
            <dd className="mb-3 md:mb-0">{REPORT_STATUS_LEGEND.weeks.explanation}</dd>
          </div>
        </dl>
        <p className="mt-3">{REPORT_STATUS_LEGEND.footer}</p>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default ReportStatusLegend;
