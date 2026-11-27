import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { CELL_DETAIL_TEXTS } from "@/lib/cells/detail-texts";
import { evolutionSummary, hasNotHeld, type EvolutionPoint } from "@/lib/cells/evolution";
import { DetailSection } from "./DetailSection";

// Sob demanda (AQ-11): o Recharts fica fora do pacote principal.
const CellEvolutionChart = lazy(() => import("./CellEvolutionChart"));

const TEXTS = CELL_DETAIL_TEXTS.evolution;

/** A altura reservada desde o primeiro render, sem salto (T12). */
const CHART_HEIGHT = "h-56 md:h-64 lg:h-72";

/** A legenda em HTML, acima do gráfico (P83): traço e marcador de cada série; "×" só quando há. */
const Legend = ({ showNotHeld }: { showNotHeld: boolean }) => (
  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
    <li className="inline-flex items-center gap-1.5">
      <svg width="28" height="10" aria-hidden="true" className="shrink-0">
        <line x1="0" y1="5" x2="28" y2="5" stroke="hsl(var(--primary))" strokeWidth="2" />
        <circle cx="14" cy="5" r="4" fill="hsl(var(--primary))" />
      </svg>
      {TEXTS.participants}
    </li>
    <li className="inline-flex items-center gap-1.5">
      <svg width="28" height="10" aria-hidden="true" className="shrink-0">
        <line x1="0" y1="5" x2="28" y2="5" stroke="hsl(var(--muted-foreground))" strokeWidth="2" strokeDasharray="6 4" />
        <rect x="10" y="1" width="8" height="8" fill="hsl(var(--card))" stroke="hsl(var(--muted-foreground))" strokeWidth="2" />
      </svg>
      {TEXTS.visitors}
    </li>
    {showNotHeld && (
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="w-7 text-center text-base leading-none text-muted-foreground">
          ×
        </span>
        {TEXTS.notHeld}
      </li>
    )}
  </ul>
);

/** A mesma informação do gráfico, na mesma ordem (P83). */
const EvolutionTable = ({ points }: { points: readonly EvolutionPoint[] }) => (
  <Table>
    <caption className="sr-only">{TEXTS.tableCaption}</caption>
    <TableHeader>
      <TableRow>
        <TableHead scope="col">{TEXTS.date}</TableHead>
        <TableHead scope="col" className="text-right">
          {TEXTS.participants}
        </TableHead>
        <TableHead scope="col" className="text-right">
          {TEXTS.visitors}
        </TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {points.map((point) => (
        <TableRow key={point.id}>
          <TableCell className="tabular-nums">{point.fullDate}</TableCell>
          {point.held ? (
            <>
              <TableCell className="text-right tabular-nums">{point.participants}</TableCell>
              <TableCell className="text-right tabular-nums">{point.visitors}</TableCell>
            </>
          ) : (
            <TableCell colSpan={2} className="text-right">
              {TEXTS.notHeld}
            </TableCell>
          )}
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

/**
 * Evolução (RN-20, T12, P83): as abas "Gráfico" (padrão) e "Tabela", com os
 * até 10 relatórios mais recentes em ordem cronológica. A escolha da aba não
 * vai para a URL.
 */
export const CellEvolution = ({ points }: { points: readonly EvolutionPoint[] }) => {
  const reduced = usePrefersReducedMotion();
  return (
    <DetailSection title={CELL_DETAIL_TEXTS.sections.evolution} className="md:col-span-2 xl:col-span-3">
      <Tabs defaultValue="chart" className="space-y-3">
        <TabsList className="grid h-11 w-full grid-cols-2 md:inline-grid md:w-auto">
          <TabsTrigger value="chart" className="min-h-9">
            {TEXTS.chartTab}
          </TabsTrigger>
          <TabsTrigger value="table" className="min-h-9">
            {TEXTS.tableTab}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chart" className="space-y-3">
          <Legend showNotHeld={hasNotHeld(points)} />
          <figure role="img" aria-label={evolutionSummary(points)} className={`w-full ${CHART_HEIGHT}`}>
            <Suspense fallback={<Skeleton className={`w-full ${CHART_HEIGHT}`} />}>
              <CellEvolutionChart points={points} animate={!reduced} />
            </Suspense>
          </figure>
        </TabsContent>
        <TabsContent value="table">
          <EvolutionTable points={points} />
        </TabsContent>
      </Tabs>
    </DetailSection>
  );
};
