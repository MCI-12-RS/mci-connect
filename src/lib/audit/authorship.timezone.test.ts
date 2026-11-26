import { afterAll, describe, expect, it } from "vitest";

// UX-02: a data da autoria é a de Brasília, com o navegador em outro fuso. O fuso é trocado antes de
// importar o módulo (o Intl lê o TZ do processo).
const originalTz = process.env.TZ;
process.env.TZ = "Asia/Tokyo";
const { authorshipLines } = await import("./authorship");

afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("UX-02: autoria no horário de Brasília com o navegador em Tóquio", () => {
  it("um cadastro de 21/11/2026 às 23:59 (Brasília) aparece como '21/11/2026 às 23:59'", () => {
    const [line] = authorshipLines("member", {
      created_at: "2026-11-22T02:59:00Z",
      created_by_kind: "member",
      created_by_name: "Bruno Lima",
      updated_at: null,
      updated_by_kind: null,
      updated_by_name: null,
    });
    expect(line.text).toBe("Cadastrado por Bruno Lima em 21/11/2026 às 23:59");
  });
});
