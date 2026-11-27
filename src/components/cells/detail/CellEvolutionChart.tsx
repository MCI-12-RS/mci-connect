import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { CELL_DETAIL_TEXTS } from "@/lib/cells/detail-texts";
import type { EvolutionPoint } from "@/lib/cells/evolution";

const TEXTS = CELL_DETAIL_TEXTS.evolution;

/** As cores das séries vêm dos tokens do tema (T12): passam de 3:1 sobre o `card` nos dois temas. */
const CONFIG = {
  participants: { label: TEXTS.participants, color: "hsl(var(--primary))" },
  visitors: { label: TEXTS.visitors, color: "hsl(var(--muted-foreground))" },
} satisfies ChartConfig;

interface DotProps {
  cx?: number;
  cy?: number;
  value?: number | null;
}

/** Visitantes: marcador em quadrado vazado (a série se distingue também sem cor). */
const SquareDot = ({ cx, cy, value }: DotProps) =>
  cx === undefined || cy === undefined || value === null || value === undefined ? null : (
    <rect x={cx - 4} y={cy - 4} width={8} height={8} fill="hsl(var(--card))" stroke="var(--color-visitors)" strokeWidth={2} />
  );

interface CellEvolutionChartProps {
  points: readonly EvolutionPoint[];
  animate: boolean;
}

/**
 * O gráfico de linhas da evolução (RN-20, T12, P83). É o único arquivo que
 * importa `@/components/ui/chart` (Recharts), carregado por `React.lazy`: o
 * Recharts fica fora do pacote principal. "Não houve célula" é um intervalo
 * nas duas linhas (nulo, `connectNulls={false}`) com a linha vertical
 * tracejada e o "×" no alto.
 */
const CellEvolutionChart = ({ points, animate }: CellEvolutionChartProps) => {
  const dateById = new Map(points.map((point) => [point.id, point]));
  const data = points.map((point) => ({ ...point }));
  return (
    <ChartContainer config={CONFIG} className="aspect-auto h-56 w-full md:h-64 lg:h-72">
      <LineChart data={data} margin={{ top: 20, right: 12, bottom: 0, left: -16 }} accessibilityLayer={false}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="id"
          tickFormatter={(id: string) => dateById.get(id)?.shortDate ?? ""}
          interval="preserveStartEnd"
          minTickGap={16}
          tickLine={false}
          axisLine={false}
        />
        <YAxis allowDecimals={false} domain={[0, "auto"]} tickLine={false} axisLine={false} width={40} />
        <ChartTooltip
          content={
            <ChartTooltipContent labelFormatter={(id) => (typeof id === "string" ? (dateById.get(id)?.fullDate ?? "") : "")} />
          }
        />
        {points
          .filter((point) => !point.held)
          .map((point) => (
            <ReferenceLine
              key={point.id}
              x={point.id}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
              label={{ value: "×", position: "top", fill: "hsl(var(--muted-foreground))", fontSize: 16 }}
            />
          ))}
        <Line
          dataKey="participants"
          type="linear"
          stroke="var(--color-participants)"
          strokeWidth={2}
          dot={{ r: 4, fill: "var(--color-participants)", stroke: "var(--color-participants)" }}
          activeDot={{ r: 5 }}
          connectNulls={false}
          isAnimationActive={animate}
        />
        <Line
          dataKey="visitors"
          type="linear"
          stroke="var(--color-visitors)"
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={<SquareDot />}
          activeDot={false}
          connectNulls={false}
          isAnimationActive={animate}
        />
      </LineChart>
    </ChartContainer>
  );
};

export default CellEvolutionChart;
