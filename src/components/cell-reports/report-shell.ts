import { createContext, useContext, useLayoutEffect } from "react";
import type { FormDialogActions } from "@/components/form/FormDialog";

/** O que o conteúdo do diálogo diz à casca: o título, o rodapé e o que "Fechar" faz. */
export interface ReportShellConfig {
  title: string;
  /** Sem ações: só "Fechar" (aviso antes de preencher, carregando, recusa final). */
  actions?: FormDialogActions;
  onClose: () => void;
}

export type Register = (config: ReportShellConfig) => void;

export const ReportShellContext = createContext<Register | null>(null);

/** O que muda o que a casca mostra; as funções são lidas na hora pelo `ref`. */
export function signature({ title, actions }: ReportShellConfig): string {
  if (!actions) return JSON.stringify({ title });
  const { formId, primaryLabel, busyLabel, busy, disabled, errorCount, failure, slowText } = actions;
  return JSON.stringify({
    title,
    formId,
    primaryLabel,
    busyLabel,
    busy,
    disabled,
    errorCount,
    failure,
    slowText,
  });
}

/** O conteúdo do formulário de relatório informa a casca a cada render. */
export function useReportShell(config: ReportShellConfig) {
  const register = useContext(ReportShellContext);
  useLayoutEffect(() => {
    register?.(config);
  });
}
