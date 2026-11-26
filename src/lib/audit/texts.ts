// Textos do E2.05 (autoria e Auditoria). Todos os textos do spec ficam aqui;
// os módulos de domínio reaproveitam os daqui, sem repetir a string.

/** Salvar nos formulários de membro, célula e relatório (T5, UXD-9, RN-04 b e RN-14). */
export const AUDIT_SAVE_TEXTS = {
  /** Na edição, sem nenhuma mudança: o formulário fecha sem gravar (UXD-9, P-AUD-20). */
  unchanged: "Nenhuma alteração para salvar.",
  /**
   * A gravação não aconteceu por falha da Auditoria, do servidor ou da rede, ou por um erro que a
   * tela não reconhece (RN-14, AQ-8): junto da ação primária, com os dados mantidos.
   */
  connection: {
    /** O texto do E2.04 (T7). */
    member: "Não foi possível salvar o cadastro. Verifique a conexão e tente de novo.",
    cell: "Não foi possível salvar a célula. Verifique a conexão e tente de novo.",
    report: "Não foi possível salvar o relatório. Verifique a conexão e tente de novo.",
  },
} as const;
