import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PAGE_SIZES, lastPage } from "@/lib/pagination";

interface ListPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  /** Rótulos do total, no singular e no plural. Ex.: ["membro", "membros"]. */
  itemLabel: [string, string];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

/** Rodapé das listas paginadas no servidor (E1.08, RN-01). */
const ListPagination = ({ page, pageSize, total, itemLabel, onPageChange, onPageSizeChange }: ListPaginationProps) => {
  const last = lastPage(total, pageSize);
  const current = Math.min(page, last);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t px-4 py-3">
      <p className="text-sm text-muted-foreground">
        {total.toLocaleString("pt-BR")} {total === 1 ? itemLabel[0] : itemLabel[1]}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <div className="flex items-center gap-2">
          <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
            <SelectTrigger className="h-8 w-[72px]" aria-label="Itens por página">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">por página</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onPageChange(1)} disabled={current <= 1} aria-label="Primeira página">
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onPageChange(current - 1)} disabled={current <= 1} aria-label="Página anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="px-2 text-sm whitespace-nowrap">
            Página {current} de {last}
          </span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onPageChange(current + 1)} disabled={current >= last} aria-label="Próxima página">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onPageChange(last)} disabled={current >= last} aria-label="Última página">
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ListPagination;
