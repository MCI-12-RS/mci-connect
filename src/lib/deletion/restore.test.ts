import { describe, it, expect } from "vitest";
import { APP_ERROR_HINT, parseAppError } from "@/lib/errors";
import type { DeletedCellReportRow, DeletedCellRow } from "./deleted-lists";
import {
  cellReportRestoreBlock,
  cellRestoreBlock,
  classifyRestoreError,
  memberRestoreConsequences,
  memberRestoreNotices,
  parseMemberRestoreOutcome,
  refreshesAfterRestore,
  restoreBlockFromRefusal,
  restoreFixLabel,
  restoreFixPath,
} from "./restore";

// Restauração (E2.01, T5, T6, RN-15 a RN-17, UX-20, UX-22 a UX-24).

const appError = (code: string, message: string, extra: object = {}) => ({
  code: "22023",
  message,
  details: JSON.stringify({ code, ...extra }),
  hint: APP_ERROR_HINT,
});

const gateError = (code: string) => ({ code: "42501", message: "x", details: JSON.stringify({ code }), hint: APP_ERROR_HINT });

describe("classifyRestoreError", () => {
  it("o 42501 do portão da senha (E2.03) é o portão, antes da falta de permissão", () => {
    expect(classifyRestoreError(gateError("password_change_required"))).toEqual({ kind: "gate", code: "password_change_required" });
    expect(classifyRestoreError(gateError("session_ended"))).toEqual({ kind: "gate", code: "session_ended" });
    expect(refreshesAfterRestore({ kind: "gate" })).toBe(false);
  });

  it("'não está excluído' e 'não encontrado' viram aviso informativo, com a mensagem do servidor (UX-24)", () => {
    expect(classifyRestoreError(appError("not_deleted", "Esta célula não está excluída.", { entity: "cell" }))).toEqual({
      kind: "stale",
      message: "Esta célula não está excluída.",
    });
    expect(classifyRestoreError(appError("not_found", "Este cadastro não foi encontrado.", { entity: "member" }))).toEqual({
      kind: "stale",
      message: "Este cadastro não foi encontrado.",
    });
  });

  it("as recusas de regra vão para o bloqueio, com a recusa inteira (UX-23)", () => {
    const result = classifyRestoreError(
      appError("restore_value_in_use", "Não é possível restaurar: outro cadastro já usa este celular.", { fields: ["mobile"] }),
    );
    expect(result).toEqual({
      kind: "refused",
      refusal: {
        code: "restore_value_in_use",
        message: "Não é possível restaurar: outro cadastro já usa este celular.",
        detail: { code: "restore_value_in_use", fields: ["mobile"] },
      },
    });
  });

  it("42501, rede e erro técnico", () => {
    expect(classifyRestoreError({ code: "42501", message: "Você não tem permissão para esta ação." })).toEqual({ kind: "forbidden" });
    expect(classifyRestoreError({ code: "", message: "TypeError: Failed to fetch" })).toEqual({ kind: "network" });
    expect(classifyRestoreError({ code: "XX000", message: "boom" })).toEqual({ kind: "unexpected" });
  });

  it("a lista recarrega no sucesso, no aviso e na recusa; não na falha de conexão nem de permissão", () => {
    expect(refreshesAfterRestore({ kind: "done" })).toBe(true);
    expect(refreshesAfterRestore({ kind: "stale" })).toBe(true);
    expect(refreshesAfterRestore({ kind: "refused" })).toBe(true);
    expect(refreshesAfterRestore({ kind: "network" })).toBe(false);
    expect(refreshesAfterRestore({ kind: "forbidden" })).toBe(false);
    expect(refreshesAfterRestore({ kind: "unexpected" })).toBe(false);
  });
});

describe("membro: confirmação (T5, UX-20)", () => {
  const base = { restore_role_name: "Líder", has_account: true, leader_name: "Gil Souza", leader_deleted: false };

  it("com conta: a função, a volta do acesso e o cônjuge", () => {
    expect(memberRestoreConsequences(base)).toEqual([
      "O cadastro volta às listas e aos totais, com os mesmos dados e a função Líder.",
      "A pessoa volta a entrar no sistema com a mesma senha.",
      "O vínculo de cônjuge não volta. Se havia, refaça-o no cadastro.",
    ]);
  });

  it("sem conta, sem a linha do acesso (AQ-7)", () => {
    expect(memberRestoreConsequences({ ...base, has_account: false })).not.toContain(
      "A pessoa volta a entrar no sistema com a mesma senha.",
    );
  });

  it("com o líder excluído, o aviso de volta sem líder", () => {
    expect(memberRestoreConsequences({ ...base, leader_deleted: true })).toContain(
      "Volta sem líder, porque o líder anterior (Gil Souza) foi excluído.",
    );
    expect(memberRestoreConsequences({ ...base, leader_deleted: true, leader_name: null })).toContain(
      "Volta sem líder, porque o líder anterior (Membro sem nome) foi excluído.",
    );
  });

  it("a função com que ele volta é a da restauração (a padrão, se a dele foi apagada); sem função, sem o nome", () => {
    expect(memberRestoreConsequences({ ...base, restore_role_name: "Membro" })[0]).toBe(
      "O cadastro volta às listas e aos totais, com os mesmos dados e a função Membro.",
    );
    expect(memberRestoreConsequences({ ...base, restore_role_name: null, has_account: false })[0]).toBe(
      "O cadastro volta às listas e aos totais, com os mesmos dados.",
    );
  });
});

describe("membro: resultado (T5, RN-16 a e d)", () => {
  it("lê a linha de restore_member", () => {
    expect(
      parseMemberRestoreOutcome([
        { restored_without_leader: true, previous_leader_name: "Gil Souza", role_reset_to_default: false, role_name: "Líder" },
      ]),
    ).toEqual({ restoredWithoutLeader: true, previousLeaderName: "Gil Souza", roleResetToDefault: false, roleName: "Líder" });
  });

  it("num formato inesperado, nada a avisar", () => {
    const nothing = { restoredWithoutLeader: false, previousLeaderName: null, roleResetToDefault: false, roleName: null };
    expect(parseMemberRestoreOutcome(null)).toEqual(nothing);
    expect(parseMemberRestoreOutcome([])).toEqual(nothing);
    expect(parseMemberRestoreOutcome("x")).toEqual(nothing);
  });

  it("sem líder: a mensagem do Negócio e o 'Definir líder' (UX-22)", () => {
    expect(
      memberRestoreNotices({ restoredWithoutLeader: true, previousLeaderName: "Gil Souza", roleResetToDefault: false, roleName: "Líder" }),
    ).toEqual({
      messages: ["Cadastro restaurado sem líder, porque o líder anterior (Gil Souza) foi excluído. Defina o novo líder."],
      withoutLeader: true,
    });
  });

  it("com a função padrão: o aviso da função, sem 'Definir líder'", () => {
    expect(
      memberRestoreNotices({ restoredWithoutLeader: false, previousLeaderName: null, roleResetToDefault: true, roleName: "Membro" }),
    ).toEqual({
      messages: ["O cadastro voltou com a função padrão (Membro), porque a função anterior foi apagada."],
      withoutLeader: false,
    });
  });

  it("os dois avisos juntos, na ordem do wireframe; sem nada, só o toast", () => {
    expect(
      memberRestoreNotices({ restoredWithoutLeader: true, previousLeaderName: "Gil", roleResetToDefault: true, roleName: "Membro" })
        .messages,
    ).toHaveLength(2);
    expect(
      memberRestoreNotices({ restoredWithoutLeader: false, previousLeaderName: null, roleResetToDefault: false, roleName: "Líder" }),
    ).toEqual({ messages: [], withoutLeader: false });
  });
});

describe("bloqueios antecipados pela lista (T6, UX-23)", () => {
  const cell: DeletedCellRow = {
    id: "c1",
    type: "Evangelística",
    meeting_day: "Quarta",
    meeting_time: "20:00:00",
    neighborhood: "Centro",
    leader_id: "m-rui",
    leader_name: "Rui Prado",
    leader_deleted: false,
    timothy_id: "m-tito",
    timothy_name: "Tito Lima",
    timothy_deleted: false,
    host_id: "m-quintino",
    host_name: "Quintino Reis",
    host_deleted: true,
    deleted_at: "2026-11-12T13:05:00Z",
    deleted_by_name: "Elisa Martins",
    deleted_by_kind: "member",
  };

  it("célula com o anfitrião excluído: a mensagem do Negócio e 'Ver membros excluídos' com o nome", () => {
    const block = cellRestoreBlock(cell);
    expect(block).toEqual({
      message:
        "Não é possível restaurar a célula: o anfitrião Quintino Reis foi excluído. Restaure o cadastro dele antes ou crie uma célula nova.",
      fix: { kind: "deletedMembers", search: "Quintino Reis" },
    });
    expect(restoreFixPath(block.fix)).toBe("/members/deleted?q=Quintino+Reis");
    expect(restoreFixLabel(block.fix)).toBe("Ver membros excluídos");
  });

  it("mais de uma pessoa excluída: cita a primeira, na ordem líder, timóteo, anfitrião (DA-5)", () => {
    expect(cellRestoreBlock({ ...cell, timothy_deleted: true })?.fix).toEqual({ kind: "deletedMembers", search: "Tito Lima" });
    expect(cellRestoreBlock({ ...cell, leader_deleted: true, timothy_deleted: true })?.message).toContain("o líder Rui Prado");
  });

  it("célula sem pessoa excluída: nada a antecipar", () => {
    expect(cellRestoreBlock({ ...cell, host_deleted: false })).toBeNull();
  });

  const report: DeletedCellReportRow = {
    id: "r1",
    date: "2026-11-19",
    time: "20:00:00",
    was_held: true,
    theme: "Fé que move",
    cell_leader_name: "Carlos Lima",
    cell_deleted: false,
    week_taken: true,
    deleted_at: "2026-11-20T11:00:00Z",
    deleted_by_name: "Gil Souza",
    deleted_by_kind: "member",
  };

  it("relatório com a semana ocupada: a mensagem do Negócio e 'Ver relatórios da célula' com o líder", () => {
    const block = cellReportRestoreBlock(report);
    expect(block).toEqual({
      message: "Esta célula já tem outro relatório na mesma semana. Exclua-o antes de restaurar este.",
      fix: { kind: "cellReports", search: "Carlos Lima" },
    });
    expect(restoreFixPath(block.fix)).toBe("/cell-reports?q=Carlos+Lima");
    expect(restoreFixLabel(block.fix)).toBe("Ver relatórios da célula");
  });

  it("semana livre: nada a antecipar; sem o nome do líder, só 'Fechar'", () => {
    expect(cellReportRestoreBlock({ ...report, week_taken: false })).toBeNull();
    expect(cellReportRestoreBlock({ ...report, cell_leader_name: null })?.fix).toBeNull();
  });
});

describe("bloqueios do servidor (T6, UX-23)", () => {
  const refusal = (code: string, message: string, extra: object = {}) => parseAppError(appError(code, message, extra));

  it("pessoa excluída: 'Ver membros excluídos' com o nome dos detalhes", () => {
    const message =
      "Não é possível restaurar a célula: o timóteo Tito Lima foi excluído. Restaure o cadastro dele antes ou crie uma célula nova.";
    expect(
      restoreBlockFromRefusal(
        refusal("restore_person_deleted", message, {
          people: [
            { role: "timothy", member_id: "m2", member_name: "Tito Lima" },
            { role: "host", member_id: "m3", member_name: "Quintino Reis" },
          ],
        }),
      ),
    ).toEqual({ message, fix: { kind: "deletedMembers", search: "Tito Lima" } });
  });

  it("pessoa excluída sem os detalhes: a mensagem, só com 'Fechar'", () => {
    expect(restoreBlockFromRefusal(refusal("restore_person_deleted", "Recusado.", { people: [] }))).toEqual({
      message: "Recusado.",
      fix: null,
    });
  });

  it("semana ocupada: 'Ver relatórios da célula' com o líder da linha", () => {
    expect(
      restoreBlockFromRefusal(refusal("restore_week_taken", "Esta célula já tem outro relatório na mesma semana.", { report_id: "r9" }), "Carlos Lima"),
    ).toEqual({
      message: "Esta célula já tem outro relatório na mesma semana.",
      fix: { kind: "cellReports", search: "Carlos Lima" },
    });
  });

  it("dado em uso e função acima: só a mensagem, com 'Fechar' (T6)", () => {
    expect(
      restoreBlockFromRefusal(refusal("restore_value_in_use", "Não é possível restaurar: outro cadastro já usa este e-mail.")),
    ).toEqual({ message: "Não é possível restaurar: outro cadastro já usa este e-mail.", fix: null });
    expect(restoreBlockFromRefusal(refusal("restore_role_above", "Você não tem permissão para restaurar este membro."))).toEqual({
      message: "Você não tem permissão para restaurar este membro.",
      fix: null,
    });
  });
});
