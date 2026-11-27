import { cn } from "@/lib/utils";
import type { CellBlock } from "@/lib/cell-reports/snapshot";
import { CELL_BLOCK_TEXTS } from "@/lib/cell-reports/texts";

interface CellSnapshotBlockProps {
  block: CellBlock;
  /** "single" mantém uma coluna em toda largura (o painel "Ver relatório", estreito mesmo no desktop). */
  layout?: "responsive" | "single";
  className?: string;
}

/** As linhas em duas `dl` a partir de 768 px: pessoas e G12 à esquerda; tipo, dia e horário e endereço à direita (T1). */
const LEFT_COLUMN = 4;

/**
 * O bloco da célula do relatório (E2.11, P105, T2): só leitura, numa caixa
 * `bg-card` (nunca o `muted`, que deixaria os rótulos abaixo de 4,5:1). No
 * retrato, a frase "Líder, timóteo, anfitrião e tipo registrados no envio.".
 * O mesmo componente no formulário e no "Ver relatório".
 */
export function CellSnapshotBlock({ block, layout = "responsive", className }: CellSnapshotBlockProps) {
  const columns = [block.lines.slice(0, LEFT_COLUMN), block.lines.slice(LEFT_COLUMN)];
  return (
    <section
      aria-label={CELL_BLOCK_TEXTS.ariaLabel}
      className={cn("rounded-lg border bg-card p-3 text-card-foreground", className)}
    >
      <div className={cn("grid gap-x-6 gap-y-2", layout === "responsive" && "md:grid-cols-2")}>
        {columns.map((lines, column) => (
          <dl key={column} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-3 gap-y-2">
            {lines.map((line) => (
              <div key={line.label} className="contents">
                <dt className="text-sm text-muted-foreground">{line.label}</dt>
                <dd
                  className={cn(
                    "min-w-0 break-words text-sm",
                    line.empty === "address" ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {line.empty === "none" ? (
                    <>
                      <span aria-hidden="true">{line.value}</span>
                      <span className="sr-only">{CELL_BLOCK_TEXTS.noneSr}</span>
                    </>
                  ) : (
                    line.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
      {block.snapshot && <p className="mt-3 text-sm text-muted-foreground">{CELL_BLOCK_TEXTS.snapshotNote}</p>}
    </section>
  );
}
