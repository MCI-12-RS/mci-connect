import type { ReactNode } from "react";

/**
 * O rodapé fixo abaixo de 768 px (P80, UXD-6, T8): a ação mais frequente
 * ("Novo relatório") à vista em qualquer ponto da rolagem, acima da área
 * segura. Fica no fim do DOM, e some a partir de 768 px.
 */
export const CellDetailFooter = ({ children }: { children: ReactNode }) => (
  <div
    className="fixed inset-x-0 bottom-0 z-40 border-t bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:hidden"
    data-testid="cell-detail-footer"
  >
    {children}
  </div>
);
