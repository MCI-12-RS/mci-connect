import { describe, expect, it } from "vitest";
import {
  ACTION_LABELS,
  ENTITY_LABELS,
  actorText,
  changeItems,
  eventNameLists,
  eventRecord,
  eventSecondLine,
  readChanges,
  toAuditEvent,
  type AuditEvent,
} from "./events";

// E2.05, T7 e T10 (UXD-6, P32; RN-15, RN-19, RN-20; UX-18 a UX-21).
const event = (overrides: Partial<AuditEvent> = {}): AuditEvent => ({
  id: "e1",
  occurred_at: "2026-11-24T00:50:00Z",
  seq: 1,
  actor_kind: "member",
  actor_label: "Bruno Lima",
  action: "update",
  entity: "member",
  entity_id: "m-igor",
  entity_label: "Igor Nunes",
  description: "Alterou o membro Igor Nunes",
  changed_fields: null,
  changes: null,
  metadata: null,
  success: true,
  error_reason: null,
  ...overrides,
});

const igorChange = event({
  changed_fields: ["leader_id", "mobile_whatsapp"],
  changes: {
    fields: [
      { field: "leader_id", from: "Bruno Lima", to: "Pedro Alves", from_id: "a", to_id: "b" },
      { field: "mobile_whatsapp" },
    ],
  },
});

describe("UX-18: rótulos de ação e de entidade", () => {
  it("'Alteração' e 'Restauração', na ordem da T7, sem 'Atualização'", () => {
    expect(Object.values(ACTION_LABELS).slice(0, 4)).toEqual(["Criação", "Alteração", "Exclusão", "Restauração"]);
    expect(Object.values(ACTION_LABELS)).not.toContain("Atualização");
  });

  it("'Função' existe e 'Participante' não", () => {
    expect(Object.values(ENTITY_LABELS)).toEqual(["Membro", "Célula", "Relatório", "Função", "Autenticação"]);
  });
});

describe("UX-21: o autor", () => {
  it("'Sistema' sem pessoa, nada no login sem sessão, o nome de quem fez", () => {
    expect(actorText({ actor_kind: "system", actor_label: null })).toBe("Sistema");
    expect(actorText({ actor_kind: "none", actor_label: null })).toBeNull();
    expect(actorText({ actor_kind: "member", actor_label: "Ana Souza" })).toBe("Ana Souza");
  });
});

describe("UXD-6: a segunda linha", () => {
  it("alteração de membro: os campos pelo rótulo", () => {
    expect(eventSecondLine(igorChange)).toBe("Líder, Celular/WhatsApp");
  });

  it("mais de 3 campos: 'e mais N'", () => {
    const fields = ["name", "leader_id", "spouse_id", "city", "phone"].map((field) => ({ field }));
    expect(eventSecondLine(event({ changes: { fields } }))).toBe("Nome, Líder, Cônjuge e mais 2");
  });

  it("envio de relatório: o número de participantes", () => {
    const sent = (n: number) => event({ entity: "cell_report", action: "create", changes: { participants: { sent: Array.from({ length: n }, (_, i) => ({ id: `${i}`, name: `P${i}` })) } } });
    expect(eventSecondLine(sent(8))).toBe("8 participantes");
    expect(eventSecondLine(sent(1))).toBe("1 participante");
  });

  it("alteração de relatório: campos e participantes incluídos e retirados", () => {
    const e = event({
      entity: "cell_report",
      changes: {
        fields: [{ field: "offering", from: 50, to: 80 }],
        participants: { added: [{ id: "1", name: "Lia" }], removed: [{ id: "2", name: "Rui" }, { id: "3", name: "Sara" }] },
      },
    });
    expect(eventSecondLine(e)).toBe("Oferta · 1 participante incluído · 2 participantes retirados");
  });

  it("funções: criação, alteração e exclusão; a troca da padrão fica sem segunda linha", () => {
    expect(eventSecondLine(event({ entity: "role", action: "create", changes: { permissions: { all: ["view_dashboard", "edit_member"] } } }))).toBe("2 permissões");
    expect(eventSecondLine(event({ entity: "role", action: "delete", changes: { permissions: { all: ["view_dashboard"] } } }))).toBe("1 permissão");
    expect(
      eventSecondLine(
        event({
          entity: "role",
          changes: { fields: [{ field: "name", from: "A", to: "B" }], permissions: { added: ["view_sensitive_data"], removed: ["edit_member"] } },
        }),
      ),
    ).toBe("Nome · 1 permissão incluída · 1 permissão retirada");
    expect(eventSecondLine(event({ entity: "role", changes: { default_role: { current: { id: "1", name: "Secretaria" }, previous: { id: "2", name: "Membro" } } } }))).toBeNull();
  });

  it("cadastro, exclusão e restauração: sem segunda linha", () => {
    for (const action of ["create", "delete", "restore"] as const) {
      expect(eventSecondLine(event({ action, changes: { fields: [{ field: "name" }] } }))).toBeNull();
    }
  });

  it("login (falha): a segunda linha do E1.04", () => {
    expect(
      eventSecondLine(event({ entity: "auth", action: "login_failed", actor_kind: "none", entity_label: "Ana Souza", metadata: { reason: "wrong_password" } })),
    ).toBe("Senha incorreta · Ana Souza");
  });
});

describe("UX-19 e P32: campos alterados no painel", () => {
  it("Líder com antes e depois; Celular/WhatsApp só pelo nome", () => {
    expect(changeItems(igorChange)).toEqual([
      { field: "leader_id", label: "Líder", values: { from: "Bruno Lima", to: "Pedro Alves" } },
      { field: "mobile_whatsapp", label: "Celular/WhatsApp", values: null },
    ]);
  });

  it("oferta em reais, data em dd/mm/aaaa e '(vazio)'", () => {
    const e = event({
      entity: "cell_report",
      changes: {
        fields: [
          { field: "offering", from: 50, to: 80 },
          { field: "date", from: "2026-11-24", to: "2026-11-25" },
          { field: "theme", from: null, to: "Fé" },
        ],
      },
    });
    expect(changeItems(e).map((item) => item.values)).toEqual([
      { from: "R$ 50,00", to: "R$ 80,00" },
      { from: "24/11/2026", to: "25/11/2026" },
      { from: "(vazio)", to: "Fé" },
    ]);
  });

  it("um campo de valor sem o antes e o depois no evento (convertido) aparece só pelo nome; um campo desconhecido não aparece", () => {
    const e = event({ changes: { fields: [{ field: "name" }, { field: "auth_user_id", from: "x", to: "y" }] } });
    expect(changeItems(e)).toEqual([{ field: "name", label: "Nome", values: null }]);
  });

  it("o JSON fora do formato não quebra", () => {
    expect(readChanges("texto")).toEqual({ fields: [], participants: null, permissions: null, defaultRole: null });
    expect(changeItems(event({ changes: { fields: "x" } }))).toEqual([]);
    expect(changeItems(event({ changes: { fields: [1, null, { from: 1 }] } }))).toEqual([]);
  });
});

describe("UX-20 e P-AUD-24: listas do painel", () => {
  it("permissões pelos rótulos do E2.02, sem o identificador", () => {
    const lists = eventNameLists(event({ entity: "role", changes: { permissions: { added: ["view_sensitive_data"], removed: ["edit_member", "nao_existe"] } } }));
    expect(lists).toEqual([
      { key: "permissionsAdded", title: "Permissões incluídas", items: ["Ver Dados Sensíveis"] },
      { key: "permissionsRemoved", title: "Permissões retiradas", items: ["Editar Membro"] },
    ]);
    expect(JSON.stringify(lists)).not.toContain("edit_member");
  });

  it("participantes do envio e da alteração, pelo nome", () => {
    expect(eventNameLists(event({ entity: "cell_report", action: "create", changes: { participants: { sent: [{ id: "1", name: "Lia" }] } } }))).toEqual([
      { key: "participants", title: "Participantes", items: ["Lia"] },
    ]);
    expect(
      eventNameLists(event({ entity: "cell_report", changes: { participants: { added: [{ id: "1", name: "Lia" }], removed: [{ id: "2", name: "Rui" }] } } })),
    ).toEqual([
      { key: "participantsAdded", title: "Participantes incluídos", items: ["Lia"] },
      { key: "participantsRemoved", title: "Participantes retirados", items: ["Rui"] },
    ]);
  });
});

describe("UXD-8: o registro do histórico", () => {
  it("membro, célula e relatório; função e autenticação não", () => {
    expect(eventRecord(igorChange)).toEqual({ type: "member", id: "m-igor" });
    expect(eventRecord(event({ entity: "cell_report", entity_id: "r1" }))).toEqual({ type: "cell_report", id: "r1" });
    expect(eventRecord(event({ entity: "role", entity_id: "f1" }))).toBeNull();
    expect(eventRecord(event({ entity: "auth" }))).toBeNull();
    expect(eventRecord(event({ entity_id: null }))).toBeNull();
  });
});

describe("toAuditEvent", () => {
  it("descarta a linha sem o essencial", () => {
    const row = { ...igorChange, id: null };
    expect(toAuditEvent(row)).toBeNull();
    expect(toAuditEvent({ ...igorChange })?.id).toBe("e1");
  });
});
