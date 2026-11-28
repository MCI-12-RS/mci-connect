import { forwardRef, type ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { SHEET_HIDE_DEFAULT_CLOSE, SheetCloseButton } from "@/components/SheetCloseButton";
import { cn } from "@/lib/utils";

interface RecordSheetProps {
  open: boolean;
  /** "✕", `Esc` e toque fora. */
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  title: ReactNode;
  /** A linha embaixo do título, lida junto com ele ("Célula de …"). Sem ela, o painel não tem descrição. */
  description?: ReactNode;
  /** O nome do "✕" (44×44 px). */
  closeLabel: string;
  /** O rodapé fixo com as ações que mudam o registro; sem ações, nada (P92). */
  footer?: ReactNode;
  /** O corpo recarregando depois de uma gravação: `opacity-60` e `aria-busy` (P44). */
  busy?: boolean;
  children: ReactNode;
}

/**
 * O painel de consulta de um registro (P92, E2.12): `Sheet` à direita, em tela cheia no celular e
 * com 512 px a partir de 640 px. O cabeçalho (título e "✕") e o rodapé ficam fixos, e o corpo rola.
 * Ao abrir, o foco vai para o título (a `ref` aponta para ele).
 */
export const RecordSheet = forwardRef<HTMLHeadingElement, RecordSheetProps>(function RecordSheet(
  { open, onClose, onCloseAutoFocus, title, description, closeLabel, footer, busy = false, children },
  titleRef,
) {
  const focusTitle = (event: Event) => {
    event.preventDefault();
    if (titleRef && typeof titleRef !== "function") titleRef.current?.focus();
  };
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className={cn("flex w-full flex-col gap-0 p-0 motion-reduce:!animate-none sm:max-w-lg", SHEET_HIDE_DEFAULT_CLOSE)}
        onOpenAutoFocus={focusTitle}
        onCloseAutoFocus={onCloseAutoFocus}
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <div className="relative border-b px-4 py-3 pr-14 sm:px-6">
          <SheetTitle ref={titleRef} tabIndex={-1} className="break-words text-lg focus:outline-none">
            {title}
          </SheetTitle>
          <SheetCloseButton label={closeLabel} />
        </div>
        <div
          className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6", busy && "opacity-60")}
          aria-busy={busy || undefined}
        >
          {description && <SheetDescription asChild>{description}</SheetDescription>}
          {children}
        </div>
        {footer && (
          <div className="border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6">{footer}</div>
        )}
      </SheetContent>
    </Sheet>
  );
});
