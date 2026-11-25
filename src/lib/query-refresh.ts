import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * As raízes das chaves de consulta cujos valores mudam quando um membro ou uma
 * célula é gravado (E2.06, AQ-6 e DT-16). Cada raiz cobre todas as consultas
 * que começam por ela:
 *
 * - `["members"]`: a lista (`list`), os excluídos (`deleted`), os seletores
 *   (`options`, `name`), o cadastro aberto (`detail`, `address`) e a árvore de
 *   Ministérios (`ministry-tree`): nível, liderança, G12 e totais;
 * - `["cells"]`: a lista (`list`), as excluídas (`deleted`), o seletor
 *   (`options`) e a célula aberta (`detail`): o G12 e o nível do líder;
 * - `["cell_reports"]`: a lista, os excluídos, o relatório aberto e os
 *   participantes, que mostram os dados da célula e das pessoas (DA-6);
 * - `["dashboard"]`: os números, as células por tipo e o ranking por G12.
 */
const HIERARCHY_QUERY_ROOTS: readonly QueryKey[] = [["members"], ["cells"], ["cell_reports"], ["dashboard"]];

/**
 * Descarta o que as telas fechadas guardaram, para carregarem do zero na
 * próxima visita, sem mostrar o valor de antes, e recarrega a tela aberta
 * (P44, UXD-10). Resolve quando a tela aberta terminou de recarregar.
 */
async function refreshHierarchyQueries(queryClient: QueryClient): Promise<void> {
  for (const queryKey of HIERARCHY_QUERY_ROOTS) queryClient.removeQueries({ queryKey, type: "inactive" });
  await Promise.all(
    HIERARCHY_QUERY_ROOTS.map((queryKey) => queryClient.invalidateQueries({ queryKey, refetchType: "active" })),
  );
}

/** Depois de toda gravação de membro: cadastro, edição, inativação, exclusão e restauração. */
export function refreshAfterMemberWrite(queryClient: QueryClient): Promise<void> {
  return refreshHierarchyQueries(queryClient);
}

/**
 * Depois de toda gravação de célula: cadastro, edição, inativação, exclusão e
 * restauração. A célula muda os totais de células de toda a cadeia do líder,
 * então desatualiza as mesmas telas que a gravação de membro.
 */
export function refreshAfterCellWrite(queryClient: QueryClient): Promise<void> {
  return refreshHierarchyQueries(queryClient);
}
