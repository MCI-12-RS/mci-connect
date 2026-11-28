import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * As raízes das chaves de consulta cujos valores mudam quando um membro, uma
 * célula ou um relatório é gravado (E2.06, AQ-6 e DT-16; E2.09, AQ-3). Cada raiz cobre todas as consultas
 * que começam por ela:
 *
 * - `["members"]`: a lista (`list`), os excluídos (`deleted`), os seletores
 *   (`options`, `name`), o cadastro aberto (`detail`, `address`) e a árvore de
 *   Ministérios (`ministry-tree`): nível, liderança, G12 e totais;
 * - `["cells"]`: a lista (`list`), as excluídas (`deleted`), o seletor
 *   (`options`) e a célula aberta (`detail`): o G12, o nível do líder e a
 *   situação do relatório (E2.09);
 * - `["cell_reports"]`: a lista, os excluídos, o relatório aberto e os
 *   participantes, que mostram os dados da célula e das pessoas (DA-6);
 * - `["dashboard"]`: os números (inclusive o card de pendentes, E2.09, e os
 *   tipos de célula, E2.14) e o ranking por G12.
 *
 * Nunca `resetQueries` (E2.14, AQ-7, DT-08): com a tela aberta, ele traria de
 * volta o `Skeleton` e esconderia os cards condicionais do Dashboard.
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

/** A chave é de uma das raízes acima? (Para o `use-access` não invalidar essas duas vezes.) */
export function isHierarchyQueryKey(queryKey: QueryKey): boolean {
  return HIERARCHY_QUERY_ROOTS.some((root) => root[0] === queryKey[0]);
}

/** Depois de toda gravação de membro: cadastro, edição, inativação, exclusão e restauração. */
export function refreshAfterMemberWrite(queryClient: QueryClient): Promise<void> {
  return refreshHierarchyQueries(queryClient);
}

/**
 * Depois de toda gravação de relatório: lançar, editar (também quando só os
 * participantes falharam), excluir e restaurar (E2.09, RN-09 e AQ-3). O
 * relatório muda a situação da célula na lista de Células, o card de
 * pendentes do Dashboard e o vínculo celular dos membros (E2.07): a tela
 * fechada carrega do zero, sem a situação de antes, e a aberta recarrega.
 */
export function refreshAfterReportWrite(queryClient: QueryClient): Promise<void> {
  return refreshHierarchyQueries(queryClient);
}

/** O acesso de quem está logado (`ACCESS_QUERY_KEY` de `use-access`): a chave inteira é `["access", userId]`. */
const ACCESS_ROOT: QueryKey = ["access"];

/**
 * Depois de toda gravação de célula: cadastro, edição, inativação, exclusão e
 * restauração. A célula muda os totais de células de toda a cadeia do líder,
 * então desatualiza as mesmas telas que a gravação de membro, e também o
 * acesso: o atalho "Novo relatório" do Dashboard depende de haver célula ativa
 * em que a pessoa lança (`my_access().can_submit_some_report`; E2.08, AQ-8, DT-14).
 * O acesso nunca é descartado, só relido.
 */
export async function refreshAfterCellWrite(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    refreshHierarchyQueries(queryClient),
    queryClient.invalidateQueries({ queryKey: ACCESS_ROOT }, { cancelRefetch: false }),
  ]);
}

/**
 * Quando o próprio acesso muda (função ou permissões; a impressão digital do
 * `my_access()`, E2.02): desatualiza os números como uma gravação (E2.14,
 * DA-6). Sem isso, uma tela em cache mostraria por um instante os números do
 * escopo antigo como atuais.
 */
export function refreshAfterAccessChange(queryClient: QueryClient): Promise<void> {
  return refreshHierarchyQueries(queryClient);
}
