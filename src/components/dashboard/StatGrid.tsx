import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A grade de cards de número (P114): uma lista, com as colunas pela largura
 * do conteúdo (1 em 320 px, 2 em 360 px, 6 em 1280 px). O `role="list"` volta
 * a semântica que o Safari tira com `list-style: none`.
 */
const StatGrid = ({ children, className }: { children: ReactNode; className?: string }) => (
  <ul role="list" className={cn("grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3 md:gap-4", className)}>
    {children}
  </ul>
);

export default StatGrid;
