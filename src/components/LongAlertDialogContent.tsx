import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { AlertDialogContent } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

/**
 * Conteúdo de `AlertDialog` com texto longo ou lista (padrão P9 do E2.01):
 * margem lateral no celular, rolagem por dentro com a fonte grande e sem
 * animação para quem pediu menos movimento.
 */
const LongAlertDialogContent = forwardRef<
  ElementRef<typeof AlertDialogContent>,
  ComponentPropsWithoutRef<typeof AlertDialogContent>
>(({ className, ...props }, ref) => (
  <AlertDialogContent
    ref={ref}
    className={cn("w-[calc(100%-2rem)] max-h-[90dvh] overflow-y-auto rounded-lg motion-reduce:!animate-none", className)}
    {...props}
  />
));
LongAlertDialogContent.displayName = "LongAlertDialogContent";

/** Botões do rodapé: 44 px no celular, e o texto quebra linha em vez de estourar (UX-40). */
export const DIALOG_FOOTER_BUTTON = "h-auto min-h-11 whitespace-normal md:min-h-10";

export default LongAlertDialogContent;
