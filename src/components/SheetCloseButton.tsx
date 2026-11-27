import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SheetClose } from "@/components/ui/sheet";

/**
 * O "✕" de um painel (`Sheet`), no lugar do que o `SheetContent` traz: com 44×44 px e o nome em pt-BR.
 * Quem usa esconde o do `SheetContent` com `[&>button:last-child]:hidden` (ele é o último filho).
 */
export const SHEET_HIDE_DEFAULT_CLOSE = "[&>button:last-child]:hidden";

export function SheetCloseButton({ label }: { label: string }) {
  return (
    <SheetClose asChild>
      <Button type="button" variant="ghost" size="icon" className="absolute right-2 top-2 h-11 w-11" aria-label={label}>
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </SheetClose>
  );
}
