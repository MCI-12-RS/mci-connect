import { test, expect, type Page } from "@playwright/test";
import { e2eEnv, sql, lit, type E2EEnv } from "./exclusao-support";
import * as F from "./membros-filtros-support";

// Cada filtro da lista de Membros contra o resultado do servidor (E2.07, RN-01 a RN-15, RN-17), pela URL
// (o mesmo que o painel grava), com a massa do spec. Rita vê a igreja toda; Pedro (Líder de G12) só o ramo
// dele: nenhum filtro pode mostrar quem ele não vê (RN-03). As listas são conferidas só nos nomes da massa.

let env: E2EEnv;

test.beforeAll(async () => {
  env = e2eEnv();
  await F.removeAccounts(env);
  F.cleanup(env);
  await F.seed(env);
  // Batizados: Pedro, André e Caio (a massa do spec não tem batismo).
  for (const person of [F.PEDRO, F.ANDRE, F.CAIO]) {
    sql(env, `UPDATE public.members SET is_baptized = true, baptism_date = '2020-01-05' WHERE id = ${lit(F.memberId(person))};`);
  }
});

test.afterAll(async () => {
  if (!env) return;
  await F.removeAccounts(env);
  F.cleanup(env);
});

test.beforeEach(async ({ page }) => {
  F.resetThrottle(env);
  await page.setViewportSize({ width: 1280, height: 800 });
});

const total = (page: Page) => page.getByRole("status").filter({ hasText: /^\d[\d.]* membros?$/ }).first();

async function names(page: Page, query: string): Promise<string[]> {
  await page.goto(`/members?${query}&size=100`);
  await F.waitForList(page);
  return F.listedNames(page);
}

const spToday = (page: Page, offsetDays = 0) =>
  page.evaluate((offset) => {
    const d = new Date(Date.now() + offset * 86_400_000);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
  }, offsetDays);

test.describe("Rita (a igreja toda): cada filtro, na ordem de nível e nome (RN-15)", () => {
  test.beforeEach(async ({ page }) => F.signIn(page, F.RITA));

  test("RN-06: Cidade e Bairro contêm o texto, sem acento nem maiúsculas; sem cidade nunca entra", async ({ page }) => {
    expect(await names(page, "city=CANOAS")).toEqual([F.CARLA.name]);
    expect(await names(page, "city=porto")).toEqual([F.ANDRE.name, F.CAIO.name]);
    expect(await names(page, "neighborhood=sao%20joao")).toEqual([F.CARLA.name, F.CAIO.name]);
    // Espaços nas pontas somem e os seguidos contam como um.
    expect(await names(page, "neighborhood=%20%20S%C3%83O%20%20JO%20")).toEqual([F.CARLA.name, F.CAIO.name]);
  });

  test("RN-07: Situação e Batizado", async ({ page }) => {
    expect(await names(page, "status=inactive")).toEqual([F.FABIO.name]);
    const active = await names(page, "status=active");
    expect(active).not.toContain(F.FABIO.name);
    expect(active).toHaveLength(18);
    expect(await names(page, "baptized=yes")).toEqual([F.PEDRO.name, F.ANDRE.name, F.CAIO.name]);
    const notBaptized = await names(page, "baptized=no");
    expect(notBaptized).toHaveLength(16);
    expect(notBaptized).not.toContain(F.PEDRO.name);
  });

  test("RN-08: Situação de liderança (Pastor, Sem liderança, Com líder; quem está abaixo de um sem liderança é 'com líder')", async ({ page }) => {
    expect(await names(page, "leadership=pastor")).toEqual([F.MAGDA.name, F.SAMUEL.name]);
    expect(await names(page, "leadership=no_leadership")).toEqual([F.ESTER.name]);
    const withLeader = await names(page, "leadership=with_leader");
    expect(withLeader).toHaveLength(16);
    expect(withLeader).toContain(F.LUCIA.name);
    expect(withLeader).not.toContain(F.ESTER.name);
    expect(withLeader).not.toContain(F.SAMUEL.name);
    // OU dentro do filtro.
    expect(await names(page, "leadership=pastor,no_leadership")).toEqual([F.MAGDA.name, F.SAMUEL.name, F.ESTER.name]);
  });

  test("RN-09: Nível (sem liderança fora de todas as opções; abaixo de sem liderança conta a partir dele)", async ({ page }) => {
    expect(await names(page, "level=0")).toEqual([F.MAGDA.name, F.SAMUEL.name]);
    expect(await names(page, "level=1")).toEqual([F.LUCIA.name, F.PAULA.name, F.PEDRO.name, F.TANIA.name, F.TIAGO.name]);
    expect(await names(page, "level=4")).toEqual([F.GABRIEL.name]);
    expect(await names(page, "level=5plus")).toEqual([F.JONAS.name]);
    const all = await names(page, "level=0,1,2,3,4,5plus");
    expect(all).toHaveLength(18);
    expect(all).not.toContain(F.ESTER.name);
  });

  test("RN-10: Vínculo celular (célula ativa; inativa e excluída não dão vínculo; categorias somam)", async ({ page }) => {
    expect(await names(page, "cell_link=leader")).toEqual([F.ANDRE.name, F.DIEGO.name, F.DEBORA.name]);
    expect(await names(page, "cell_link=timothy")).toEqual([F.HUGO.name, F.RITA.name, F.CAIO.name]);
    expect(await names(page, "cell_link=host")).toEqual([F.BEATRIZ.name, F.CARLA.name, F.CAIO.name]);
    expect(await names(page, "cell_link=leader,host")).toEqual([
      F.ANDRE.name, F.BEATRIZ.name, F.CARLA.name, F.DIEGO.name, F.CAIO.name, F.DEBORA.name,
    ]);
    // Fábio é anfitrião só de célula inativa e Jonas/Gabriel só de inativa e excluída.
    const roles = await names(page, "cell_link=leader,timothy,host");
    for (const person of [F.FABIO, F.GABRIEL, F.JONAS]) expect(roles).not.toContain(person.name);
  });

  test("RN-12: datas de cadastro, inclusive nos dois dias, só uma ponta e futura", async ({ page }) => {
    const today = await spToday(page);
    const from = await spToday(page, -15);
    const to = await spToday(page, -5);
    expect(await names(page, `from=${from}&to=${to}`)).toEqual([F.JONAS.name]);
    const sinceToday = await names(page, `from=${today}`);
    expect(sinceToday).not.toContain(F.JONAS.name);
    expect(sinceToday).toHaveLength(18);
    expect(await names(page, `from=${await spToday(page, 3)}`)).toEqual([]);
    // "Até" futuro (sábado da semana): todos.
    expect(await names(page, `to=${await spToday(page, 6)}`)).toHaveLength(19);
  });

  test("RN-02: a combinação restringe (E entre filtros, OU dentro do filtro) e o total é o do resultado", async ({ page }) => {
    expect(await names(page, "status=active&city=porto")).toEqual([F.ANDRE.name, F.CAIO.name]);
    expect(await names(page, "status=active&city=porto&baptized=yes&level=3")).toEqual([F.CAIO.name]);
    await expect(total(page)).toHaveText("1 membro");
    expect(await names(page, "status=active&city=porto&baptized=no")).toEqual([]);
    expect(await names(page, `status=active&level=2,3&cell_link=leader&leaders=${F.memberId(F.PEDRO)}`)).toEqual([F.ANDRE.name]);
  });

  test("RN-04: Liderança em qualquer nível, sem a própria pessoa e sem o cônjuge, e a busca soma como E", async ({ page }) => {
    expect(await names(page, `leaders=${F.memberId(F.ANDRE)}`)).toEqual([F.CAIO.name, F.FABIO.name, F.GABRIEL.name, F.JONAS.name]);
    // Andre + Fábio: Fábio entra por André; ninguém repetido.
    expect(await names(page, `leaders=${F.memberId(F.ANDRE)},${F.memberId(F.FABIO)}`)).toEqual([
      F.CAIO.name, F.FABIO.name, F.GABRIEL.name, F.JONAS.name,
    ]);
    // A busca é E com o filtro.
    expect(await names(page, `leaders=${F.memberId(F.ANDRE)}&q=gabriel`)).toEqual([F.GABRIEL.name]);
  });

  test("RN-15, total exato: páginas de 10 percorrem o resultado sem repetir nem pular", async ({ page }) => {
    const order = [
      F.MAGDA, F.SAMUEL, F.LUCIA, F.PAULA, F.PEDRO, F.TANIA, F.TIAGO, F.ANDRE, F.BEATRIZ, F.CARLA, F.DIEGO, F.HUGO, F.RITA,
    ].map((person) => person.name);
    const seen: string[] = [];
    for (const pageNumber of [1, 2]) {
      await page.goto(`/members?level=0,1,2&size=10&page=${pageNumber}`);
      await F.waitForList(page);
      await expect(total(page)).toHaveText(/^\d+ membros$/);
      seen.push(...(await F.listedNames(page)));
    }
    expect(seen).toEqual(order);
  });
});

test.describe("Pedro (Líder de G12): o filtro só restringe o que ele já vê (RN-03)", () => {
  test.beforeEach(async ({ page }) => F.signIn(page, F.PEDRO));

  test("nenhum filtro traz pastor, quem está sem liderança nem outro G12", async ({ page }) => {
    expect(await names(page, "level=0")).toEqual([]);
    expect(await names(page, "leadership=pastor")).toEqual([]);
    expect(await names(page, "leadership=no_leadership")).toEqual([]);
    await expect(total(page)).toHaveText("0 membros");
    const everything = await names(page, "level=1,2,3,4,5plus");
    for (const outside of [F.SAMUEL, F.MAGDA, F.ESTER, F.LUCIA, F.TIAGO, F.TANIA, F.RITA, F.DIEGO, F.HUGO, F.DEBORA, F.BEATRIZ]) {
      expect(everything, outside.name).not.toContain(outside.name);
    }
    expect(await names(page, "city=canoas")).toEqual([F.CARLA.name]);
    expect(await names(page, "neighborhood=centro")).toEqual([F.ANDRE.name]);
    // Diego e Hugo lideram células, mas não estão no ramo de Pedro: Vínculo celular não os revela.
    expect(await names(page, "cell_link=leader,timothy")).toEqual([F.ANDRE.name, F.CAIO.name]);
  });

  test("RN-17: o link de Rita para 'Sem vínculo' mostra a Pedro só o que ele vê, com o total certo", async ({ page }) => {
    expect(await names(page, "status=active&cell_link=none")).toEqual([F.PAULA.name, F.GABRIEL.name, F.JONAS.name]);
    await expect(total(page)).toHaveText("3 membros");
  });

  test("a rede de uma pessoa fora do escopo não vaza: Diego, Tiago e Tânia dão 'Pessoa indisponível' e 0 membros", async ({ page }) => {
    const ids = [F.DIEGO, F.TANIA].map(F.memberId).join(",");
    expect(await names(page, `leaders=${ids}`)).toEqual([]);
    await expect(total(page)).toHaveText("0 membros");
    await expect(page.getByRole("button", { name: "Remover filtro Liderança: Pessoa indisponível" })).toHaveCount(2);
  });

  test("UX-11, RN-14: ida e volta: sair da lista e voltar restaura filtros, chips e total", async ({ page }) => {
    await page.goto("/members?status=active&cell_link=none");
    await F.waitForList(page);
    await page.goto("/cells");
    await page.goBack();
    await F.waitForList(page);
    await expect(page).toHaveURL(/status=active&cell_link=none|cell_link=none&status=active/);
    await expect(page.getByRole("button", { name: "Remover filtro Situação: Ativo" })).toBeVisible();
    await expect(total(page)).toHaveText("3 membros");
    await page.goForward();
    await page.goBack();
    await F.waitForList(page);
    expect(await F.listedNames(page)).toEqual([F.PAULA.name, F.GABRIEL.name, F.JONAS.name]);
  });
});
