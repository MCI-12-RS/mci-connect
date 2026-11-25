import { describe, it, expect } from "vitest";
import {
  deletedMatchesWarning,
  parseCreateMemberRefusal,
  parseDeletedMatches,
  type DeletedMatch,
  type DeletedMatchesDialogModel,
  type DeletedMatchesWarning,
} from "./deleted-matches";
import { DELETED_MATCHES_TEXTS } from "@/lib/deletion/texts";

// 10/11/2026 12:00 em Brasília.
const NOV_10 = "2026-11-10T15:00:00Z";

const match = (overrides: Partial<DeletedMatch> = {}): DeletedMatch => ({
  memberId: "m-bruno",
  name: "Bruno Almeida",
  deletedAt: NOV_10,
  matchedFields: ["email"],
  isAccountEmail: false,
  ...overrides,
});

/** Correspondência sem nome: quem não é administrador, ou fora do escopo do administrador (DA-8). */
const anonymous = (overrides: Partial<DeletedMatch> = {}): DeletedMatch =>
  match({ memberId: null, name: null, deletedAt: null, ...overrides });

function dialogOf(warning: DeletedMatchesWarning): DeletedMatchesDialogModel {
  if (warning.kind !== "dialog") throw new Error(`esperava o diálogo, veio ${warning.kind}`);
  return warning.dialog;
}

const ADMIN = { isAdmin: true, accountEmail: false } as const;
const OTHER = { isAdmin: false, accountEmail: false } as const;

describe("parseDeletedMatches", () => {
  it("lê as linhas de find_deleted_member_matches, com os dados na ordem das frases e sem repetir", () => {
    expect(
      parseDeletedMatches([
        {
          member_id: "m1",
          name: "Bruno",
          deleted_at: NOV_10,
          matched_fields: ["cpf", "email", "cpf", "outro"],
          is_account_email: true,
        },
      ]),
    ).toEqual([{ memberId: "m1", name: "Bruno", deletedAt: NOV_10, matchedFields: ["email", "cpf"], isAccountEmail: true }]);
  });

  it("aceita os nulos de quem não pode ver o cadastro", () => {
    expect(
      parseDeletedMatches([
        { member_id: null, name: null, deleted_at: null, matched_fields: ["mobile"], is_account_email: false },
      ]),
    ).toEqual([anonymous({ matchedFields: ["mobile"] })]);
  });

  it("entrada inválida: lista vazia, e itens fora do formato ficam de fora", () => {
    expect(parseDeletedMatches(null)).toEqual([]);
    expect(parseDeletedMatches("x")).toEqual([]);
    expect(parseDeletedMatches({ member_id: "m1" })).toEqual([]);
    expect(parseDeletedMatches([null, 3, "x", []])).toEqual([]);
    expect(parseDeletedMatches([{ member_id: 5, matched_fields: "email" }])).toEqual([
      { memberId: null, name: null, deletedAt: null, matchedFields: [], isAccountEmail: false },
    ]);
  });
});

describe("deletedMatchesWarning: administrador", () => {
  it("1 cadastro: título no singular, a mensagem com o nome e a data, Restaurar e Cadastrar mesmo assim", () => {
    const dialog = dialogOf(deletedMatchesWarning([match()], ADMIN));
    expect(dialog.title).toBe("Há um cadastro excluído com estes dados");
    expect(dialog.restorable).toEqual([
      {
        memberId: "m-bruno",
        name: "Bruno Almeida",
        message: "Já existe um cadastro excluído com este e-mail: Bruno Almeida, excluído em 10/11/2026.",
        restoreLabel: "Restaurar Bruno Almeida",
      },
    ]);
    expect(dialog.anonymous).toBeNull();
    expect(dialog.explanation).toBe(DELETED_MATCHES_TEXTS.explanation);
    expect(dialog.accountEmailHint).toBeNull();
    expect(dialog.canRegisterAnyway).toBe(true);
  });

  it("N cadastros: título com o número e um bloco por cadastro (e-mail num, CPF no outro)", () => {
    const dialog = dialogOf(
      deletedMatchesWarning(
        [match(), match({ memberId: "m-souza", name: "Bruno L. Souza", deletedAt: "2025-03-02T15:00:00Z", matchedFields: ["cpf"] })],
        ADMIN,
      ),
    );
    expect(dialog.title).toBe("Há 2 cadastros excluídos com estes dados");
    expect(dialog.restorable.map((item) => item.restoreLabel)).toEqual([
      "Restaurar Bruno Almeida",
      "Restaurar Bruno L. Souza",
    ]);
    expect(dialog.restorable[1].message).toBe(
      "Já existe um cadastro excluído com este CPF: Bruno L. Souza, excluído em 02/03/2025.",
    );
  });

  it("mais de um dado do mesmo cadastro e cadastro sem data", () => {
    const dialog = dialogOf(
      deletedMatchesWarning([match({ matchedFields: ["email", "mobile", "cpf"], deletedAt: null })], ADMIN),
    );
    expect(dialog.restorable[0].message).toBe(
      "Já existe um cadastro excluído com este e-mail, este celular e este CPF: Bruno Almeida.",
    );
  });

  it("fora do escopo (DA-8): o aviso sai como para quem não é administrador, sem nome", () => {
    const dialog = dialogOf(deletedMatchesWarning([anonymous({ matchedFields: ["mobile"] })], ADMIN));
    expect(dialog.title).toBe("Há um cadastro excluído com este celular");
    expect(dialog.restorable).toEqual([]);
    expect(dialog.anonymous).toEqual({ heading: null, text: DELETED_MATCHES_TEXTS.othersText });
    expect(dialog.explanation).toBeNull();
    expect(dialog.canRegisterAnyway).toBe(true);
  });

  it("mistura de restauráveis e anônimos: os anônimos ganham o próprio título", () => {
    const dialog = dialogOf(
      deletedMatchesWarning(
        [match(), anonymous({ matchedFields: ["cpf"] }), anonymous({ matchedFields: ["mobile"] })],
        ADMIN,
      ),
    );
    expect(dialog.title).toBe("Há 3 cadastros excluídos com estes dados");
    expect(dialog.restorable).toHaveLength(1);
    expect(dialog.anonymous).toEqual({
      heading: "Há cadastros excluídos com este celular e este CPF",
      text: DELETED_MATCHES_TEXTS.othersText,
    });
    expect(dialog.explanation).toBe(DELETED_MATCHES_TEXTS.explanation);
    expect(dialog.canRegisterAnyway).toBe(true);
  });

  it("e-mail da conta que ele pode restaurar: sem Cadastrar mesmo assim, com a dica de usar outro e-mail", () => {
    const dialog = dialogOf(
      deletedMatchesWarning(
        [
          match({ isAccountEmail: true }),
          match({ memberId: "m-souza", name: "Bruno L. Souza", matchedFields: ["cpf"] }),
          anonymous({ matchedFields: ["mobile"] }),
        ],
        { isAdmin: true, accountEmail: true },
      ),
    );
    expect(dialog.canRegisterAnyway).toBe(false);
    expect(dialog.accountEmailHint).toBe("Para cadastrar outra pessoa, volte e use outro e-mail.");
    expect(dialog.restorable.map((item) => item.name)).toEqual(["Bruno Almeida", "Bruno L. Souza"]);
    expect(dialog.anonymous).toBeNull();
    expect(dialog.title).toBe("Há 2 cadastros excluídos com estes dados");
  });

  it("e-mail da conta fora do escopo: erro no campo E-mail, sem diálogo", () => {
    expect(
      deletedMatchesWarning([anonymous({ isAccountEmail: true }), match({ matchedFields: ["cpf"] })], {
        isAdmin: true,
        accountEmail: true,
      }),
    ).toEqual({ kind: "emailError", message: DELETED_MATCHES_TEXTS.accountEmailError });
  });

  it("e-mail da conta recusado pelo banco, sem as correspondências: erro no campo E-mail", () => {
    expect(deletedMatchesWarning([], { isAdmin: true, accountEmail: true })).toEqual({
      kind: "emailError",
      message: "Este e-mail pertence a um cadastro excluído. Peça a um administrador para restaurá-lo ou use outro e-mail.",
    });
  });
});

describe("deletedMatchesWarning: quem não é administrador", () => {
  it.each([
    [["mobile"], "Há um cadastro excluído com este celular"],
    [["cpf"], "Há um cadastro excluído com este CPF"],
    [["mobile", "cpf"], "Há um cadastro excluído com este celular e este CPF"],
  ] as const)("%j: o aviso sem nome, com Cadastrar mesmo assim", (fields, title) => {
    const dialog = dialogOf(deletedMatchesWarning([anonymous({ matchedFields: [...fields] })], OTHER));
    expect(dialog.title).toBe(title);
    expect(dialog.restorable).toEqual([]);
    expect(dialog.anonymous).toEqual({
      heading: null,
      text: "Se for a mesma pessoa, peça a um administrador para restaurá-lo. Se for outra pessoa, você pode cadastrar mesmo assim.",
    });
    expect(dialog.explanation).toBeNull();
    expect(dialog.accountEmailHint).toBeNull();
    expect(dialog.canRegisterAnyway).toBe(true);
  });

  it("cadastros diferentes, um pelo celular e outro pelo CPF: o título no plural", () => {
    const dialog = dialogOf(
      deletedMatchesWarning([anonymous({ matchedFields: ["mobile"] }), anonymous({ matchedFields: ["cpf"] })], OTHER),
    );
    expect(dialog.title).toBe("Há cadastros excluídos com este celular e este CPF");
  });

  it("nunca mostra nome, mesmo que o servidor o mande", () => {
    const dialog = dialogOf(deletedMatchesWarning([match({ matchedFields: ["mobile"] })], OTHER));
    expect(dialog.restorable).toEqual([]);
    expect(JSON.stringify(dialog)).not.toContain("Bruno");
  });

  it("e-mail da conta: erro no campo E-mail, mesmo com o celular também combinando", () => {
    expect(
      deletedMatchesWarning([anonymous({ isAccountEmail: true }), anonymous({ matchedFields: ["mobile"] })], {
        isAdmin: false,
        accountEmail: true,
      }),
    ).toEqual({ kind: "emailError", message: DELETED_MATCHES_TEXTS.accountEmailError });
  });

  it("correspondência sem dado conhecido: 'estes dados'", () => {
    const dialog = dialogOf(deletedMatchesWarning([anonymous({ matchedFields: [] })], OTHER));
    expect(dialog.title).toBe("Há um cadastro excluído com estes dados");
  });
});

describe("parseCreateMemberRefusal", () => {
  const row = { member_id: null, name: null, deleted_at: null, matched_fields: ["mobile"], is_account_email: false };

  it("deleted_matches: as correspondências, sem o e-mail da conta", () => {
    expect(parseCreateMemberRefusal({ error: "Há um cadastro…", code: "deleted_matches", matches: [row] })).toEqual({
      kind: "deletedMatches",
      matches: [anonymous({ matchedFields: ["mobile"] })],
      accountEmail: false,
    });
  });

  it("deleted_account_email, da função (com matches) ou do banco (sem matches)", () => {
    expect(
      parseCreateMemberRefusal({ error: "Este e-mail…", code: "deleted_account_email", field: "email" }),
    ).toEqual({ kind: "deletedMatches", matches: [], accountEmail: true });
  });

  it("outra recusa: a mensagem, o código e o campo", () => {
    expect(parseCreateMemberRefusal({ error: "Já existe…", code: "x", field: "cpf" })).toEqual({
      kind: "message",
      message: "Já existe…",
      code: "x",
      field: "cpf",
    });
    expect(parseCreateMemberRefusal({ error: "Falhou" })).toEqual({
      kind: "message",
      message: "Falhou",
      code: null,
      field: null,
    });
  });

  it("corpo inválido: null", () => {
    expect(parseCreateMemberRefusal(null)).toBeNull();
    expect(parseCreateMemberRefusal("erro")).toBeNull();
    expect(parseCreateMemberRefusal({ code: "deleted_matches" })).toBeNull();
  });
});
