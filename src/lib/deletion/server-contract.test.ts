import { describe, it, expect } from "vitest";
import { parseAppError } from "@/lib/errors";
import { buildBlockerGroups, memberLinksFromRefusal } from "./blockers";
import { isDeletionErrorCode } from "./codes";
import { classifyWriteError, parseDeletionCheck } from "./outcome";
import { CELL_REPORT_FORM_TEXTS, classifyReportSaveError } from "@/lib/cell-reports/report-form";
import { DELETION_TEXTS } from "./texts";

// Contrato entre o banco e a tela (E2.01, "Formato dos erros", AQ-1, AQ-2).
// Os payloads abaixo são os que o banco devolveu de verdade, numa stack local
// com as migrations do PR 1 e do PR 2, para a massa dos critérios de aceite
// (Gil, Sara, a célula de Rui…). Só os ids foram encurtados. O PostgREST
// repassa SQLSTATE, MESSAGE, DETAIL e HINT como { code, message, details, hint }.
// Os testes de cada módulo usam payloads montados à mão; estes garantem que o
// formato real (nomes das chaves, "HH:MM", ordem das listas) é o que a tela lê.

const appError = (details: string, message: string) => ({ code: "22023", message, details, hint: "app_error" });

/** delete_member(Gil) com 4 discípulos (Léo inativo) e 2 células (a de Marcos inativa), critério da RN-04. */
const GIL_LINKS = appError(
  '{"code": "member_has_links", "cells": [{"id": "c-01", "roles": ["timothy"], "is_active": true, "leader_name": "Carlos Lima", "meeting_day": "Quarta", "meeting_time": "20:00"}, {"id": "c-02", "roles": ["host"], "is_active": false, "leader_name": "Marcos Dias", "meeting_day": "Sexta", "meeting_time": "19:30"}], "disciples": [{"id": "m-13", "name": "Hugo Lima", "is_active": true}, {"id": "m-14", "name": "Ivo Reis", "is_active": true}, {"id": "m-15", "name": "João Alves", "is_active": true}, {"id": "m-16", "name": "Léo Martins", "is_active": false}], "member_id": "m-10", "cells_total": 2, "member_name": "Gil Souza", "disciples_total": 4}',
  "Não é possível excluir Gil Souza. Antes, reatribua 4 discípulos e 2 células.",
);

/** check_member_deletion(Gil): o mesmo objeto da recusa, como dado (DT-11). */
const GIL_CHECK = {
  code: "member_has_links",
  cells: [
    { id: "c-01", roles: ["timothy"], is_active: true, leader_name: "Carlos Lima", meeting_day: "Quarta", meeting_time: "20:00" },
    { id: "c-02", roles: ["host"], is_active: false, leader_name: "Marcos Dias", meeting_day: "Sexta", meeting_time: "19:30" },
  ],
  message: "Não é possível excluir Gil Souza. Antes, reatribua 4 discípulos e 2 células.",
  disciples: [
    { id: "m-13", name: "Hugo Lima", is_active: true },
    { id: "m-14", name: "Ivo Reis", is_active: true },
    { id: "m-15", name: "João Alves", is_active: true },
    { id: "m-16", name: "Léo Martins", is_active: false },
  ],
  member_id: "m-10",
  can_delete: false,
  cells_total: 2,
  member_name: "Gil Souza",
  disciples_total: 4,
};

/** check_member_deletion de um membro com 7 discípulos: o banco manda 5. */
const SEVEN_CHECK = {
  code: "member_has_links",
  cells: [],
  message: "Não é possível excluir Sete Discípulos. Antes, reatribua 7 discípulos.",
  disciples: ["A", "B", "C", "D", "E"].map((letter, i) => ({ id: `m-4${i + 1}`, name: `Discípulo ${letter}`, is_active: true })),
  member_id: "m-40",
  can_delete: false,
  cells_total: 0,
  member_name: "Sete Discípulos",
  disciples_total: 7,
};

const SELF_DELETE = appError('{"code": "self_delete"}', "Você não pode excluir o seu próprio cadastro.");
const ROLE_ABOVE = appError('{"code": "role_above"}', "Você não tem permissão para excluir este membro.");
const MEMBER_GONE = appError('{"code": "not_found_or_deleted", "entity": "member"}', "Este cadastro não existe ou já foi excluído.");
const CELL_GONE = appError('{"code": "not_found_or_deleted", "entity": "cell"}', "Esta célula não existe ou já foi excluída.");
const REPORT_GONE = appError(
  '{"code": "not_found_or_deleted", "entity": "cell_report"}',
  "Este relatório não existe ou já foi excluído.",
);
const PERMISSION_DENIED = { code: "42501", message: "Você não tem permissão para esta ação.", details: null, hint: null };
const DELETED_MEMBER_CHOSEN = appError(
  '{"code": "deleted_member_chosen", "field": "member_id", "member_id": "m-30"}',
  "Este membro foi excluído e não pode ser escolhido.",
);
const PARTICIPANT_REMOVAL = appError(
  '{"code": "deleted_participant_removal", "member_id": "m-21"}',
  "Não é possível retirar um participante cujo cadastro foi excluído.",
);
const CELL_DELETED = appError('{"code": "cell_deleted", "cell_id": "c-03"}', "Esta célula foi excluída e não recebe relatórios.");
const REPORT_CELL_DELETED = appError(
  '{"code": "report_cell_deleted", "cell_id": "c-03"}',
  "A célula deste relatório foi excluída. Restaure a célula para editar o relatório.",
);
/** Segundo relatório da mesma célula na semana (trigger de semana única). */
const WEEK_TAKEN = {
  code: "23505",
  message: "Já existe um relatório para esta célula nesta semana (2026-11-22 a 2026-11-28).",
  details: null,
  hint: null,
};
/** Relatório fora da semana atual (trigger de semana atual). */
const OUTSIDE_WEEK = {
  code: "23514",
  message: "A data do relatório deve estar dentro da semana atual (2026-11-22 a 2026-11-28).",
  details: null,
  hint: null,
};

const GIL_GROUPS = [
  {
    kind: "disciples",
    title: "4 discípulos",
    items: [
      { id: "m-13", label: "Hugo Lima" },
      { id: "m-14", label: "Ivo Reis" },
      { id: "m-15", label: "João Alves" },
      { id: "m-16", label: "Léo Martins (inativo)" },
    ],
    more: null,
  },
  {
    kind: "cells",
    title: "2 células",
    items: [
      { id: "c-01", label: "Timóteo na célula de Carlos Lima, quarta, 20:00" },
      { id: "c-02", label: "Anfitrião na célula de Marcos Dias, sexta, 19:30 (inativa)" },
    ],
    more: null,
  },
];

describe("Contrato com o banco: exclusão de membro (RN-03, RN-04, AQ-1, AQ-2)", () => {
  it("RN-04: a recusa real de delete_member para Gil vira o bloqueio do critério (4 discípulos com Léo inativo, 2 células com papel, dia e hora)", () => {
    const refusal = parseAppError(GIL_LINKS);
    expect(refusal?.code).toBe("member_has_links");
    const links = refusal && memberLinksFromRefusal(refusal);
    expect(links).not.toBeNull();
    expect(links && buildBlockerGroups(links)).toEqual(GIL_GROUPS);
  });

  it("DT-11: a pré-checagem real de Gil dá o mesmo bloqueio que a recusa de delete_member", () => {
    const check = parseDeletionCheck(GIL_CHECK);
    expect(check).toMatchObject({ canDelete: false, failure: { kind: "refused" } });
    const failure = check?.canDelete === false ? check.failure : null;
    const links = failure?.kind === "refused" ? memberLinksFromRefusal(failure.refusal) : null;
    expect(links && buildBlockerGroups(links)).toEqual(GIL_GROUPS);
  });

  it("UX-09: com 7 discípulos, o banco manda 5, e a tela mostra 5 nomes e 'e mais 2'", () => {
    const check = parseDeletionCheck(SEVEN_CHECK);
    const failure = check?.canDelete === false ? check.failure : null;
    const links = failure?.kind === "refused" ? memberLinksFromRefusal(failure.refusal) : null;
    const [group] = links ? buildBlockerGroups(links) : [];
    expect(group.title).toBe("7 discípulos");
    expect(group.items).toHaveLength(5);
    expect(group.more).toBe("e mais 2");
  });

  it("UX-08: { can_delete: true } da pré-checagem real abre a confirmação", () => {
    expect(parseDeletionCheck({ can_delete: true })).toEqual({ canDelete: true });
  });

  it("RN-03 e UX-11: próprio cadastro e função acima são recusas de regra, sem ligações, com a mensagem do Negócio", () => {
    for (const [error, message] of [
      [SELF_DELETE, "Você não pode excluir o seu próprio cadastro."],
      [ROLE_ABOVE, "Você não tem permissão para excluir este membro."],
    ] as const) {
      const failure = classifyWriteError(error);
      expect(failure).toMatchObject({ kind: "refused", refusal: { message } });
      expect(failure.kind === "refused" ? memberLinksFromRefusal(failure.refusal) : "x").toBeNull();
    }
  });
});

describe("Contrato com o banco: corrida e permissão nas três entidades (UX-24, UX-39)", () => {
  it("UX-24: 'não existe ou já foi excluído' real de membro, célula e relatório vira o aviso informativo com o texto de cada um", () => {
    expect(classifyWriteError(MEMBER_GONE)).toEqual({ kind: "gone", message: "Este cadastro não existe ou já foi excluído." });
    expect(classifyWriteError(CELL_GONE)).toEqual({ kind: "gone", message: "Esta célula não existe ou já foi excluída." });
    expect(classifyWriteError(REPORT_GONE)).toEqual({ kind: "gone", message: "Este relatório não existe ou já foi excluído." });
  });

  it("RN-02 e UX-39: o 42501 real das RPCs de exclusão é falta de permissão, sem mensagem técnica", () => {
    expect(classifyWriteError(PERMISSION_DENIED)).toEqual({ kind: "forbidden" });
    expect(classifyReportSaveError(PERMISSION_DENIED)).toEqual({
      kind: "refused",
      message: DELETION_TEXTS.permissionDenied,
      clearCell: false,
    });
  });

  it("Todos os códigos reais estão na lista de códigos da tela", () => {
    for (const error of [GIL_LINKS, SELF_DELETE, ROLE_ABOVE, MEMBER_GONE, DELETED_MEMBER_CHOSEN, PARTICIPANT_REMOVAL, CELL_DELETED, REPORT_CELL_DELETED]) {
      const code = parseAppError(error)?.code ?? "";
      expect(isDeletionErrorCode(code), code).toBe(true);
    }
  });
});

describe("Contrato com o banco: formulário de relatório (RN-06, RN-11, RN-12, RN-13)", () => {
  it("RN-06 e UX-30: participante novo excluído vai para o campo, com o membro que o banco apontou", () => {
    expect(classifyReportSaveError(DELETED_MEMBER_CHOSEN)).toEqual({
      kind: "participants",
      message: "Este membro foi excluído e não pode ser escolhido.",
      memberId: "m-30",
    });
  });

  it("RN-13: a retirada de um participante excluído é recusada com a mensagem do Negócio, no topo", () => {
    expect(classifyReportSaveError(PARTICIPANT_REMOVAL)).toEqual({
      kind: "blocked",
      message: "Não é possível retirar um participante cujo cadastro foi excluído.",
      cellDeleted: false,
    });
  });

  it("RN-06 e RN-11: relatório para célula excluída e edição de relatório de célula excluída ficam no aviso do topo (UX-28, UX-30)", () => {
    expect(classifyReportSaveError(CELL_DELETED)).toEqual({
      kind: "blocked",
      message: "Esta célula foi excluída e não recebe relatórios.",
      cellDeleted: true,
    });
    expect(classifyReportSaveError(REPORT_CELL_DELETED)).toEqual({
      kind: "blocked",
      message: "A célula deste relatório foi excluída. Restaure a célula para editar o relatório.",
      cellDeleted: true,
    });
  });

  it("RN-12: as recusas reais de semana ocupada (23505) e de fora da semana atual (23514) viram os textos de sempre", () => {
    expect(classifyReportSaveError(WEEK_TAKEN)).toEqual({ kind: "error", message: CELL_REPORT_FORM_TEXTS.weekTaken });
    expect(classifyReportSaveError(OUTSIDE_WEEK)).toEqual({ kind: "error", message: CELL_REPORT_FORM_TEXTS.outsideCurrentWeek });
  });
});
