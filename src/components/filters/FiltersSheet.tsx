import { useRef, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SHEET_HIDE_DEFAULT_CLOSE, SheetCloseButton } from "@/components/SheetCloseButton";
import { useIsMobile } from "@/hooks/use-mobile";
import { FILTER_TEXTS } from "@/lib/filters/texts";
import { cn } from "@/lib/utils";

interface FiltersSheetProps {
  open: boolean;
  /** "✕", `Esc`, toque fora e voltar: fecha sem aplicar. */
  onClose: () => void;
  /** "Aplicar filtros" (e Enter num campo de texto). Quem usa confere, aplica e fecha. */
  onApply: () => void;
  /** "Limpar": os campos do painel voltam ao padrão, sem aplicar. */
  onClear: () => void;
  /** Ao fechar, o foco volta ao botão "Filtros". */
  onCloseAutoFocus: (event: Event) => void;
  children: ReactNode;
}

/**
 * Os filtros abaixo de 1024 px (E2.07, P50; T2): de baixo para cima no celular e da direita no tablet,
 * com o corpo rolando e o rodapé fixo ("Limpar" e "Aplicar filtros"). Ao abrir, o foco vai para o
 * título, sem abrir o teclado (UXD-15).
 */
export function FiltersSheet({ open, onClose, onApply, onClear, onCloseAutoFocus, children }: FiltersSheetProps) {
  const isMobile = useIsMobile();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onApply();
  };
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "flex flex-col gap-0 p-0 motion-reduce:animate-none",
          isMobile ? "max-h-[90dvh]" : "h-full w-full sm:max-w-md",
          SHEET_HIDE_DEFAULT_CLOSE,
        )}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <SheetCloseButton label={FILTER_TEXTS.sheetClose} />
        <SheetHeader className="border-b p-4 pr-14 text-left">
          <SheetTitle ref={titleRef} tabIndex={-1} className="focus:outline-none">
            {FILTER_TEXTS.sheetTitle}
          </SheetTitle>
          <SheetDescription className="sr-only">{FILTER_TEXTS.sheetDescription}</SheetDescription>
        </SheetHeader>
        <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden p-4">{children}</div>
          <div className="flex gap-2 border-t p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <Button type="button" variant="outline" className="h-11 flex-1" onClick={onClear}>
              {FILTER_TEXTS.clear}
            </Button>
            <Button type="submit" className="h-11 flex-1">
              {FILTER_TEXTS.apply}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
