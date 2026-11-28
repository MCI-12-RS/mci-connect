import type { CellReportDetailRow, CellReportListRow } from "@/lib/cell-reports/fields";

// As colunas do retrato e da célula de hoje que o bloco da célula lê (E2.11,
// P105), para as massas dos testes de componente do relatório.
export const reportSnapshotColumns = (leaderName: string | null) => ({
  snapshot_leader_id: "m-leader",
  snapshot_leader_name: leaderName,
  snapshot_timothy_id: "m-timothy",
  snapshot_timothy_name: "Caio Lima",
  snapshot_host_id: "m-host",
  snapshot_host_name: "Carla Dias",
  snapshot_cell_type: "Evangelística",
  snapshot_g12_leader_name: "Pedro Alves",
  snapshot_leader_g12_level: 2,
  snapshot_leader_is_pastor: false,
  cell_meeting_day: "Quarta",
  cell_meeting_time: "20:00:00",
  cell_street: "Rua das Flores",
  cell_number: "100",
  cell_neighborhood: "Centro",
});

/** As colunas do líder registrado na linha da lista de Relatórios (E2.11, T10). */
export const reportRowLeaderColumns = {
  snapshot_g12_leader_name: "Pedro Alves",
  snapshot_leader_g12_level: 2,
  snapshot_leader_is_pastor: false,
};

/** Uma linha da lista de Relatórios (E2.12, `CELL_REPORT_LIST_SELECT`): R1 da massa do Negócio. */
export const reportListRow = (
  overrides: Partial<CellReportListRow> = {},
): CellReportListRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  cell_id: "c1c1c1c1-0000-4000-8000-000000000001",
  date: "2026-11-18",
  time: "20:00:00",
  theme: "A fé que vence",
  observations: "Dois visitantes do trabalho do Caio",
  visitors: ["João Pereira", "Maria Lima"],
  offering: 50,
  was_held: true,
  reason_not_held: null,
  visitors_count: 2,
  participants_count: 8,
  ...reportRowLeaderColumns,
  snapshot_leader_name: "André Souza",
  cell_leader_name: "André Souza",
  cell_meeting_day: "Quarta",
  cell_meeting_time: "20:00:00",
  cell_street: "Rua das Flores",
  cell_number: "100",
  cell_complement: null,
  cell_neighborhood: "Centro",
  cell_deleted: false,
  ...overrides,
});

/** A mesma linha com o que a consulta lê por id (E2.12, `CELL_REPORT_DETAIL_SELECT`). */
export const reportDetailRow = (
  overrides: Partial<CellReportDetailRow> = {},
): CellReportDetailRow => ({
  ...reportListRow(),
  snapshot_leader_id: "m-leader",
  snapshot_timothy_id: "m-timothy",
  snapshot_timothy_name: "Caio Lima",
  snapshot_host_id: "m-host",
  snapshot_host_name: "Carla Dias",
  snapshot_cell_type: "Evangelística",
  cell_city: "Porto Alegre",
  cell_state: "RS",
  cell_zip_code: "90010000",
  cell_visible: true,
  created_at: "2026-11-19T00:40:00Z",
  created_by_kind: "member",
  created_by_name: "Caio Lima",
  updated_at: null,
  updated_by_kind: null,
  updated_by_name: null,
  ...overrides,
});
