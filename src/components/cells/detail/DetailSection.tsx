import { forwardRef, useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DetailSectionProps {
  title: string;
  children: ReactNode;
  className?: string;
  /** O `h2` recebe o foco por programa (`tabIndex={-1}`): "Últimos relatórios" depois de excluir um relatório (T14). */
  focusableTitle?: boolean;
  /** O texto logo depois do título (a frase das setas, P82). */
  description?: ReactNode;
}

/**
 * Uma seção do detalhe (P80, T8 e T9): `section` com `aria-labelledby` no seu
 * `h2`. No celular, separadas por borda; a partir de 768 px, caixas.
 */
export const DetailSection = forwardRef<HTMLHeadingElement, DetailSectionProps>(
  ({ title, children, className, focusableTitle = false, description }, ref) => {
    const id = useId();
    return (
      <section
        aria-labelledby={id}
        className={cn("min-w-0 space-y-3 border-t border-border pt-6 md:rounded-lg md:border md:bg-card md:p-6", className)}
      >
        <div className="space-y-1">
          <h2 id={id} ref={ref} tabIndex={focusableTitle ? -1 : undefined} className="text-lg font-semibold outline-none">
            {title}
          </h2>
          {description}
        </div>
        {children}
      </section>
    );
  },
);
DetailSection.displayName = "DetailSection";
