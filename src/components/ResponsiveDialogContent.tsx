import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface ResponsiveDialogContentProps extends Omit<ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, "title"> {
  /** O título, no cabeçalho fixo. */
  title: ReactNode;
  /** Rótulo do "✕" para leitor de tela. */
  closeLabel: string;
  /** O rodapé fixo, com os botões. */
  footer: ReactNode;
}

/**
 * Diálogo responsivo (padrão P1 de Escolas, aplicado no E2.02 T3): tela cheia
 * abaixo de `md`, com cabeçalho e rodapé fixos e só o corpo rolando; a partir
 * de `md`, o `Dialog` centralizado com `max-h-[90dvh]`. É só CSS, sem
 * `useIsMobile`, para não piscar o layout de desktop no celular. O rodapé
 * respeita a área segura (`viewport-fit=cover` no `index.html`).
 */
const ResponsiveDialogContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, ResponsiveDialogContentProps>(
  ({ title, closeLabel, footer, className, children, ...props }, ref) => (
    <DialogPortal>
      <DialogOverlay className="motion-reduce:!animate-none" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed inset-0 z-50 flex h-dvh w-full flex-col bg-background shadow-lg focus:outline-none",
          "md:inset-auto md:left-1/2 md:top-1/2 md:h-auto md:max-h-[90dvh] md:max-w-2xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:border",
          "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:!animate-none",
          className,
        )}
        {...props}
      >
        <div className="flex shrink-0 items-center gap-2 border-b px-2 py-2 md:px-4">
          <DialogPrimitive.Close asChild>
            <button
              type="button"
              aria-label={closeLabel}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </DialogPrimitive.Close>
          <DialogPrimitive.Title className="min-w-0 break-words text-lg font-semibold leading-tight">{title}</DialogPrimitive.Title>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">{children}</div>
        <div className="flex shrink-0 flex-row justify-end gap-2 border-t px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:px-6">
          {footer}
        </div>
      </DialogPrimitive.Content>
    </DialogPortal>
  ),
);
ResponsiveDialogContent.displayName = "ResponsiveDialogContent";

export default ResponsiveDialogContent;
