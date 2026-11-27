import { describe, expect, it } from "vitest";
import { authorLabel, authorshipLines, recordHistoryPath, type Authorship, type AuthorshipEntity } from "./authorship";

// E2.05, T1 e P30 (UX-01, UX-02; RN-07 a RN-11): a frase de autoria, testada por tabela.
// 21/11/2026 às 23:59 em Brasília = 22/11/2026 02:59 UTC.
const NIGHT = "2026-11-22T02:59:00Z";
const MORNING = "2026-11-20T13:15:00Z"; // 10:15 em Brasília

const authorship = (overrides: Partial<Authorship> = {}): Authorship => ({
  created_at: NIGHT,
  created_by_kind: "member",
  created_by_name: "Bruno Lima",
  updated_at: null,
  updated_by_kind: null,
  updated_by_name: null,
  ...overrides,
});

const texts = (entity: AuthorshipEntity, a: Authorship) => authorshipLines(entity, a).map((line) => line.text);

describe("UX-01: a frase de autoria (T1)", () => {
  it.each<[string, AuthorshipEntity, Partial<Authorship>, string[]]>([
    ["membro com autor e data, nunca alterado", "member", {}, ["Cadastrado por Bruno Lima em 21/11/2026 às 23:59"]],
    [
      "membro alterado",
      "member",
      { updated_at: MORNING, updated_by_kind: "member", updated_by_name: "Ana Souza" },
      ["Cadastrado por Bruno Lima em 21/11/2026 às 23:59", "Alterado por Ana Souza em 20/11/2026 às 10:15"],
    ],
    [
      "célula alterada pelo Sistema",
      "cell",
      { updated_at: MORNING, updated_by_kind: "system" },
      ["Cadastrada por Bruno Lima em 21/11/2026 às 23:59", "Alterada por Sistema em 20/11/2026 às 10:15"],
    ],
    [
      "relatório enviado e alterado",
      "cell_report",
      { created_by_name: "Carla Dias", updated_at: MORNING, updated_by_kind: "member", updated_by_name: "Ana Souza" },
      ["Enviado por Carla Dias em 21/11/2026 às 23:59", "Alterado por Ana Souza em 20/11/2026 às 10:15"],
    ],
    [
      "vindo do sistema anterior",
      "member",
      {
        created_by_kind: "legacy",
        created_by_name: "Maria Alves",
        updated_at: MORNING,
        updated_by_kind: "legacy",
        updated_by_name: "João Pires",
      },
      ["Cadastrado por Maria Alves (sistema anterior) em 21/11/2026 às 23:59", "Alterado por João Pires (sistema anterior) em 20/11/2026 às 10:15"],
    ],
    [
      "AdminUser vira Administrador (sistema anterior)",
      "member",
      { created_by_kind: "legacy", created_by_name: "AdminUser" },
      ["Cadastrado por Administrador (sistema anterior) em 21/11/2026 às 23:59"],
    ],
    [
      "Administrador já trocado pela view",
      "cell",
      { created_by_kind: "legacy", created_by_name: "Administrador" },
      ["Cadastrada por Administrador (sistema anterior) em 21/11/2026 às 23:59"],
    ],
    ["sem autor", "member", { created_by_kind: "unknown", created_by_name: null }, ["Cadastrado em 21/11/2026 às 23:59 · autor não registrado"]],
    ["legado sem nome", "member", { created_by_kind: "legacy", created_by_name: "  " }, ["Cadastrado em 21/11/2026 às 23:59 · autor não registrado"]],
    [
      "sem data",
      "member",
      { created_at: null, created_by_kind: "legacy", created_by_name: "Maria Alves" },
      ["Cadastrado por Maria Alves (sistema anterior) · data não registrada"],
    ],
    [
      "sem autor e sem data",
      "member",
      { created_at: null, created_by_kind: "unknown", created_by_name: null },
      ["Cadastrado · autor não registrado · data não registrada"],
    ],
    [
      "alteração do legado sem data",
      "cell_report",
      { updated_at: null, updated_by_kind: "legacy", updated_by_name: "João Pires" },
      ["Enviado por Bruno Lima em 21/11/2026 às 23:59", "Alterado por João Pires (sistema anterior) · data não registrada"],
    ],
  ])("%s", (_case, entity, overrides, expected) => {
    const lines = texts(entity, authorship(overrides));
    expect(lines).toEqual(expected);
    expect(lines.join(" ")).not.toContain("AdminUser");
  });

  it("separa o autor do resto, para a tela destacá-lo, e sem autor não há destaque", () => {
    const [line] = authorshipLines("member", authorship());
    expect([line.before, line.author, line.after]).toEqual(["Cadastrado por ", "Bruno Lima", " em 21/11/2026 às 23:59"]);
    const [unknown] = authorshipLines("member", authorship({ created_by_kind: "unknown", created_by_name: null }));
    expect(unknown.author).toBeNull();
  });
});

describe("authorLabel (T6 e T1)", () => {
  it.each<[Parameters<typeof authorLabel>[0], string | null, string | null]>([
    ["member", "Ana Souza", "Ana Souza"],
    ["system", null, "Sistema"],
    ["legacy", "João Pires", "João Pires (sistema anterior)"],
    ["legacy", "AdminUser", "Administrador (sistema anterior)"],
    ["legacy", null, null],
    ["unknown", "Ana", null],
    // Sem tipo (gravação em `replica`, DT-23): vale o nome, se houver.
    [null, "Elisa Martins", "Elisa Martins"],
    [null, null, null],
  ])("%s / %s → %s", (kind, name, expected) => {
    expect(authorLabel(kind, name)).toBe(expected);
  });
});

describe("recordHistoryPath (P31)", () => {
  it("leva à Auditoria filtrada pelo registro", () => {
    expect(recordHistoryPath("member", "11111111-1111-1111-1111-111111111111")).toBe(
      "/events?record_type=member&record_id=11111111-1111-1111-1111-111111111111",
    );
  });
});
