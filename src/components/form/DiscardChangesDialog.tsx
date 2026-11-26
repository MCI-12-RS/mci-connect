import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import LongAlertDialogContent, { DIALOG_FOOTER_BUTTON } from "@/components/LongAlertDialogContent";
import { DISCARD_CHANGES_TEXTS as TEXTS } from "@/lib/form/texts";
import { cn } from "@/lib/utils";

interface DiscardChangesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Descartar": fecha o formulário ou segue para onde a pessoa pediu. */
  onDiscard: () => void;
}

/**
 * "Descartar as alterações?" (UX-26; E2.05, UX-07): "Descartar" em destaque
 * destrutivo e o foco inicial em "Continuar editando" (o `AlertDialogCancel`).
 */
export function DiscardChangesDialog({ open, onOpenChange, onDiscard }: DiscardChangesDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <LongAlertDialogContent>
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle>{TEXTS.title}</AlertDialogTitle>
          <AlertDialogDescription>{TEXTS.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <AlertDialogAction className={cn(buttonVariants({ variant: "destructive" }), DIALOG_FOOTER_BUTTON)} onClick={onDiscard}>
            {TEXTS.confirm}
          </AlertDialogAction>
          <AlertDialogCancel className={cn(DIALOG_FOOTER_BUTTON, "mt-0")}>{TEXTS.keepEditing}</AlertDialogCancel>
        </AlertDialogFooter>
      </LongAlertDialogContent>
    </AlertDialog>
  );
}
