import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface FormErrorSummaryProps {
  /** Quantos campos têm erro; 0 esvazia o resumo. */
  count: number;
  /** "Confira os campos destacados ({N})." */
  text: (count: number) => string;
  className?: string;
}

/**
 * O resumo dos erros no rodapé (P22, UX-10): fica sempre na página como
 * região de status, para o leitor de tela anunciar quando o texto muda.
 */
export function FormErrorSummary({ count, text, className }: FormErrorSummaryProps) {
  return (
    <p role="status" className={cn("text-sm font-medium text-foreground empty:hidden", className)}>
      {count > 0 && (
        <span className="flex items-start gap-1.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>{text(count)}</span>
        </span>
      )}
    </p>
  );
}
