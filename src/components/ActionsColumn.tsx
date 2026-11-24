import type { TdHTMLAttributes, ThHTMLAttributes } from "react";
import { TableCell, TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// Coluna das ações de uma tabela (E2.01, P7 e UX-16), presa à direita. Entre
// 768 e 1279 px, com o menu lateral, as colunas não cabem e a tabela rola na
// horizontal: sem isso, as ações (o "Restaurar" das listas de excluídos, o
// "Editar" e o "Excluir" das listas principais) ficariam fora da vista.
//
// O fundo opaco cobre o que rola por baixo, e a sombra interna faz a linha à
// esquerda da coluna. No hover da linha, a coluna recebe o mesmo tom da linha
// (`bg-muted/50` da `TableRow`), por cima do fundo, para não aparecer um
// recorte branco.
const STICKY = "sticky right-0 z-10 whitespace-nowrap bg-card shadow-[inset_1px_0_0_hsl(var(--border))]";
const ROW_HOVER = "[tr:hover>&]:bg-[linear-gradient(hsl(var(--muted)/0.5),hsl(var(--muted)/0.5))]";

/** Cabeçalho da coluna das ações: só a largura do conteúdo. */
export function ActionsHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <TableHead className={cn(STICKY, "w-px", className)} {...props} />;
}

/** Célula da coluna das ações, alinhada à direita. */
export function ActionsCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <TableCell className={cn(STICKY, ROW_HOVER, "text-right", className)} {...props} />;
}
