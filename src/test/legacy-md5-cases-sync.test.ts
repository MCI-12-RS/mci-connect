// E3.03 (tarefa 5): o MD5 da senha do legado em três lugares iguais.
//   1. o pacote `md5` 2.3.0 (o do legado, devDependency exata);
//   2. supabase/tests/fixtures/legacy-md5-cases.json;
//   3. supabase/tests/database/e3_02_md5_cases.test.sql (pgTAP gerado do JSON).
// O gerador refaz os MD5 pelo pacote; este teste quebra se o JSON ou o SQL gravados divergirem.
// Para corrigir: node supabase/tests/fixtures/generate-legacy-md5-cases.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isWellFormedText } from "../../supabase/functions/sign-in/lib/contract";

const root = resolve(__dirname, "../..");
const generator = resolve(root, "supabase/tests/fixtures/generate-legacy-md5-cases.mjs");
const jsonPath = resolve(root, "supabase/tests/fixtures/legacy-md5-cases.json");
const sqlPath = resolve(root, "supabase/tests/database/e3_02_md5_cases.test.sql");

interface Md5Case {
  id: string;
  password: string;
  bytes: number | null;
  md5: string | null;
  db: boolean;
  unusable: boolean;
  wrong: string[];
}

const readCases = (): { md5_package: string; cases: Md5Case[] } => JSON.parse(readFileSync(jsonPath, "utf8"));
const run = (flag: string) => execFileSync("node", [generator, flag], { encoding: "utf8" });

describe("E3.03: tabela de casos do MD5 do legado", () => {
  it("o pacote instalado é o md5 2.3.0 exato (o do legado)", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    expect(pkg.devDependencies.md5).toBe("2.3.0");
    expect(readCases().md5_package).toBe("2.3.0");
  });

  it("o JSON gravado é o que o pacote calcula hoje", () => {
    expect(readFileSync(jsonPath, "utf8"), "rode: node supabase/tests/fixtures/generate-legacy-md5-cases.mjs").toBe(run("--json"));
  });

  it("o SQL do pgTAP está em dia com o JSON", () => {
    expect(readFileSync(sqlPath, "utf8"), "rode: node supabase/tests/fixtures/generate-legacy-md5-cases.mjs").toBe(run("--stdout"));
  });

  it("cobre os casos do spec (E3.03)", () => {
    const byId = new Map(readCases().cases.map((c) => [c.id, c]));
    for (const id of [
      "ascii", "cedilha_composto", "cedilha_decomposto", "espacos_pontas", "maiusculas", "emoji",
      "d11_123456", "letras_72", "letras_80", "cedilha_40", "vazio", "surrogate_isolado",
    ]) {
      expect(byId.has(id), id).toBe(true);
    }
    expect(byId.get("d11_123456")?.md5).toBe("e10adc3949ba59abbe56e057f20f883e");
    expect(byId.get("vazio")?.md5).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(byId.get("vazio")?.unusable).toBe(true);
    expect(byId.get("letras_80")?.bytes).toBe(80);
    expect(byId.get("cedilha_40")?.bytes).toBe(80);
    expect(byId.get("cedilha_40")?.password.length).toBe(40);
    expect(byId.get("cedilha_composto")?.md5).not.toBe(byId.get("cedilha_decomposto")?.md5);
  });

  it("o que o pacote não calcula nunca chega ao banco, e o que não chega é recusado pela sign-in (DA-1)", () => {
    for (const c of readCases().cases) {
      if (c.md5 === null) expect(c.db, c.id).toBe(false);
      expect(isWellFormedText(c.password), c.id).toBe(c.db);
      if (c.md5 !== null) expect(c.md5, c.id).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(readCases().cases.find((c) => c.id === "surrogate_isolado")?.md5).toBeNull();
  });
});
