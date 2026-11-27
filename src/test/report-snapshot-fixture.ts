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
