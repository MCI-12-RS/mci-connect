import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Locator } from "@playwright/test";
import {
  e2eEnv,
  expectNoButtonOverflow,
  largeFont,
  login,
  sql,
  lit,
  toast,
  type E2EEnv,
} from "./exclusao-support";
import {
  FREE_CPF,
  M,
  cleanup,
  createButton,
  expectMinHeight,
  free,
  id,
  openNew,
  removeCreatedAccounts,
  seed,
  trackApi,
  trackCreateReplies,
  who,
} from "./membro-validacoes-support";

// Formulário de membro, cadastro novo (E2.04, PR 3, tarefa 11): os critérios UX-01, 02, 04, 06, 08,
// 11 (cadastro), 13 a 16, 25, 27, 28 e 31 e as regras RN-02 a RN-17 e RN-19 pela tela, com Rita
// (Administrador, vê a igreja toda). Smoke do login pela `sign-in` com a conta recém-criada.
//
// Precisa do Supabase local com `sign-in` e `create-user-admin` servidas (ver e2e/exclusao-support.ts
// para as variáveis). Massa fictícia "QA6 Val …" (ids e2e204b0-…), apagada no fim e no começo.
// Rode com `--workers=1`: os arquivos membro-validacoes-* usam a mesma massa.

let env: E2EEnv;

test.beforeAll(async () => {
  env = e2eEnv();
  const probe = await fetch(`${env.apiUrl}/functions/v1/create-user-admin`, {
    method: "POST",
    headers: { apikey: env.publishableKey, "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => null);
  test.skip(!probe || probe.status !== 401, "Sirva a create-user-admin na stack local (supabase functions serve).");
  await removeCreatedAccounts(env);
  cleanup(env);
  seed(env);
});

test.afterAll(async () => {
  if (!env) return;
  await removeCreatedAccounts(env);
  cleanup(env);
  expect(sql(env, `SELECT count(*) FROM public.members WHERE id::text LIKE 'e2e204b0%' OR name LIKE 'QA6 Val%'`), "limpeza").toBe("0");
});

const ERR = (dialog: Locator, fieldId: string) => dialog.locator(`#${fieldId}-error`);
const created = (name: string) => Number(sql(env, `SELECT count(*) FROM public.members WHERE name = ${lit(name)}`));
const functionPosts = (calls: ReturnType<typeof trackApi>) => calls.filter((c) => c.method === "POST" && c.url.includes("/functions/v1/create-user-admin"));

/** Preenche o mínimo de um cadastro novo: nome, sexo e (por padrão) nada de liderança. */
async function fillBasics(dialog: Locator, name: string, mobile?: string, { leadership = false } = {}) {
  await dialog.getByLabel("Nome *").fill(name);
  await dialog.getByRole("radio", { name: "Feminino" }).click();
  if (mobile) await dialog.getByLabel("Celular / WhatsApp").fill(mobile);
  if (!leadership) await dialog.getByRole("switch", { name: "Tem Liderança?" }).click();
}

test.describe("UX-01, UX-02, UX-04, UX-28, UX-31: layout do formulário", () => {
  test("UX-01 (360×800): o cadastro novo ocupa a tela, com cabeçalho e rodapé fixos e a ação primária sempre à vista", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await login(page, env.admin);
    const dialog = await openNew(page);
    const box = await dialog.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(359);
    expect(box?.height).toBeGreaterThanOrEqual(799);

    const primary = createButton(dialog);
    const body = dialog.locator("div.overflow-y-auto").first();
    for (const scrollTop of [0, 400, 100000]) {
      await body.evaluate((el, top) => (el.scrollTop = top), scrollTop);
      const p = await primary.boundingBox();
      expect(p, `ação primária com scroll ${scrollTop}`).not.toBeNull();
      expect((p?.y ?? 0) + (p?.height ?? 0), `base com scroll ${scrollTop}`).toBeLessThanOrEqual(800);
      expect(p?.y ?? 0).toBeGreaterThan(400);
    }
    const title = await dialog.getByRole("heading", { name: "Novo membro" }).boundingBox();
    expect(title?.y ?? 99).toBeLessThan(80);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });

  test("UX-01 (1280): a partir de 768 px é um diálogo centralizado, com no máximo 90% da altura e o rodapé fixo", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await login(page, env.admin);
    const dialog = await openNew(page);
    // A animação de entrada do diálogo (zoom e slide) termina antes de medir.
    await expect.poll(async () => Math.abs(((await dialog.boundingBox())?.x ?? 0) + ((await dialog.boundingBox())?.width ?? 0) / 2 - 640)).toBeLessThan(3);
    const box = await dialog.boundingBox();
    expect(box?.height ?? 0).toBeLessThanOrEqual(700 * 0.9 + 1);
    expect(box?.width ?? 0).toBeLessThan(1280);
    const body = dialog.locator("div.overflow-y-auto").first();
    await body.evaluate((el) => (el.scrollTop = 100000));
    const p = await createButton(dialog).boundingBox();
    expect((p?.y ?? 0) + (p?.height ?? 0)).toBeLessThanOrEqual((box?.y ?? 0) + (box?.height ?? 0) + 1);
  });

  test("UX-01: a edição e 'Editar meus dados' também ocupam a tela em 360×800, com a ação primária à vista", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await login(page, env.admin);
    await page.goto(`/members?q=${encodeURIComponent(M.caio.name)}`);
    await page.getByRole("button", { name: `Editar ${M.caio.name}`, exact: true }).first().click();
    const edit = page.getByRole("dialog", { name: "Editar membro" });
    await expect(edit).toBeVisible();
    expect((await edit.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(799);
    const save = await edit.getByRole("button", { name: "Salvar alterações", exact: true }).boundingBox();
    expect((save?.y ?? 0) + (save?.height ?? 0)).toBeLessThanOrEqual(800);
    await edit.getByRole("button", { name: "Cancelar", exact: true }).click();

    // "Editar meus dados" fica no menu lateral, que no celular abre pelo botão do cabeçalho.
    const own = page.getByRole("button", { name: "Editar meus dados" });
    if (!(await own.isVisible())) await page.getByRole("button", { name: /menu|abrir/i }).first().click();
    await own.click();
    const mine = page.getByRole("dialog", { name: "Editar meus dados" });
    await expect(mine).toBeVisible();
    expect((await mine.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(799);
    const mineSave = await mine.getByRole("button", { name: "Salvar alterações", exact: true }).boundingBox();
    expect((mineSave?.y ?? 0) + (mineSave?.height ?? 0)).toBeLessThanOrEqual(800);
  });

  test("UX-02: uma coluna em 360 px; os pares da T1 (Sexo e Nascimento; Celular e E-mail) lado a lado em 1280 px", async ({ page }) => {
    await login(page, env.admin);
    const geometry = async () => {
      const dialog = await openNew(page);
      // O diálogo abre com animação de entrada (zoom/slide): medir no meio dela desloca as posições y.
      await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))));
      const at = async (locator: Locator) => (await locator.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
      const result = {
        name: await at(dialog.getByLabel("Nome *")),
        sexo: await at(dialog.getByRole("radiogroup", { name: /Sexo/ })),
        birth: await at(dialog.getByLabel("Data de nascimento")),
        mobile: await at(dialog.getByLabel("Celular / WhatsApp")),
        email: await at(dialog.getByLabel("E-mail")),
      };
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
      return result;
    };
    await page.setViewportSize({ width: 360, height: 800 });
    const narrow = await geometry();
    for (const [a, b] of [["name", "sexo"], ["sexo", "birth"], ["birth", "mobile"], ["mobile", "email"]] as const) {
      expect(narrow[b].y, `${a} acima de ${b}`).toBeGreaterThan(narrow[a].y + narrow[a].height - 1);
      expect(Math.abs(narrow[a].x - narrow[b].x), `${a} e ${b} alinhados`).toBeLessThan(2);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    const wide = await geometry();
    expect(Math.abs(wide.sexo.y - wide.birth.y), "Sexo e Nascimento na mesma linha").toBeLessThan(30);
    expect(wide.birth.x).toBeGreaterThan(wide.sexo.x + wide.sexo.width - 1);
    expect(Math.abs(wide.mobile.y - wide.email.y), "Celular e E-mail na mesma linha").toBeLessThan(2);
    expect(wide.email.x).toBeGreaterThan(wide.mobile.x + wide.mobile.width - 1);
  });

  test("UX-04 (360): cada opção de Sexo tem pelo menos 44 px e o toque no texto marca a opção", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await login(page, env.admin);
    const dialog = await openNew(page);
    for (const option of ["Masculino", "Feminino"]) await expectMinHeight(dialog.locator("label", { hasText: option }), `Sexo: ${option}`);
    await dialog.getByText("Feminino", { exact: true }).click();
    await expect(dialog.getByRole("radio", { name: "Feminino" })).toBeChecked();
  });

  test("UX-31 (360×800): cada linha de interruptor tem 44 px e o toque no espaço entre o texto e o interruptor muda o valor", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await login(page, env.admin);
    const dialog = await openNew(page);
    for (const name of ["É Pastor(a)?", "Tem Liderança?", "Ativo", "Batizado(a)?"]) {
      const toggle = dialog.getByRole("switch", { name });
      await toggle.scrollIntoViewIfNeeded();
      const row = dialog.locator("label", { has: page.getByRole("switch", { name }) });
      await expectMinHeight(row, `linha "${name}"`);
      const rowBox = await row.boundingBox();
      const textBox = await row.locator("span").first().boundingBox();
      const switchBox = await toggle.boundingBox();
      if (!rowBox || !textBox || !switchBox) throw new Error(`sem medida: ${name}`);
      const before = await toggle.getAttribute("aria-checked");
      // O meio do espaço entre o fim do texto e o início do interruptor.
      const x = (textBox.x + textBox.width + switchBox.x) / 2;
      expect(x, `${name}: há espaço entre o texto e o interruptor`).toBeGreaterThan(textBox.x + textBox.width);
      await page.mouse.click(x, rowBox.y + rowBox.height / 2);
      expect(await toggle.getAttribute("aria-checked"), `${name}: o toque no espaço muda o valor`).not.toBe(before);
      await page.mouse.click(x, rowBox.y + rowBox.height / 2);
      expect(await toggle.getAttribute("aria-checked"), `${name}: volta`).toBe(before);
    }
  });

  test("UX-28 (320 px, fonte a 200%): textos quebram linha sem corte, as opções de Sexo ficam uma por linha e os botões do rodapé continuam alcançáveis", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await login(page, env.admin);
    const dialog = await openNew(page);
    await largeFont(page);
    await createButton(dialog).click(); // com erros: o resumo e as mensagens também precisam quebrar linha
    await expect(dialog.getByText(/Confira os campos destacados/)).toBeVisible();

    const overflow = await dialog.evaluate((root) => {
      const bad: string[] = [];
      for (const el of root.querySelectorAll<HTMLElement>("p, label, legend, h2, h3, span")) {
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible") bad.push(el.textContent?.slice(0, 40) ?? "");
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > window.innerWidth + 1) bad.push(`fora da tela: ${el.textContent?.slice(0, 40)}`);
      }
      return bad;
    });
    expect(overflow, "nenhum texto cortado ou fora da tela").toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "sem rolagem lateral").toBeLessThanOrEqual(320);

    const male = await dialog.locator("label", { hasText: "Masculino" }).boundingBox();
    const female = await dialog.locator("label", { hasText: "Feminino" }).boundingBox();
    expect((female?.y ?? 0) - (male?.y ?? 0), "Sexo: uma opção por linha").toBeGreaterThanOrEqual((male?.height ?? 0) - 1);
    await expectMinHeight(dialog.locator("label", { hasText: "Masculino" }), "Sexo: Masculino");
    await expectMinHeight(dialog.locator("label", { hasText: "Feminino" }), "Sexo: Feminino");

    await expectNoButtonOverflow(page, dialog.locator("div").last(), "rodapé");
    for (const name of ["Cancelar", "Criar membro"]) {
      const box = await dialog.getByRole("button", { name, exact: true }).boundingBox();
      expect(box, name).not.toBeNull();
      expect((box?.y ?? 0) + (box?.height ?? 0), `${name} na tela`).toBeLessThanOrEqual(640);
      expect(box?.height ?? 0, `${name}: altura`).toBeGreaterThanOrEqual(43.5);
    }
  });
});

test.describe("UX-06: celular com o teclado de verdade", () => {
  test("Digitar ou colar mostra o número lido ao sair, sem cortar dígitos, e corrigir o 3º dígito deixa o cursor logo depois dele", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openNew(page);
    const mobile = dialog.getByLabel("Celular / WhatsApp");
    for (const [typed, shown] of [
      ["51988887777", "(51) 98888-7777"],
      ["+55 (51) 98888-7777", "(51) 98888-7777"],
      ["051 98888-7777", "(51) 98888-7777"],
      ["5133334444", "(51) 3333-4444"],
      ["(51) 98888-12345", "(51) 98888-12345"],
    ] as const) {
      await mobile.fill("");
      await mobile.pressSequentially(typed);
      const digits = (await mobile.inputValue()).replace(/\D/g, "");
      expect(digits, `${typed}: nenhum dígito cortado ao digitar`).toBe(typed.replace(/\D/g, ""));
      await dialog.getByLabel("Nome *").click(); // sai do campo
      await expect(mobile, `${typed} → ${shown}`).toHaveValue(shown);
    }

    await mobile.fill("(51) 98888-7777");
    await mobile.click();
    await mobile.evaluate((el: HTMLInputElement) => el.setSelectionRange(6, 6)); // depois do 3º dígito ("9")
    await page.keyboard.press("Backspace");
    await page.keyboard.type("8");
    expect(await mobile.inputValue()).toBe("(51) 88888-7777");
    expect(await mobile.evaluate((el: HTMLInputElement) => el.selectionStart), "cursor logo depois do dígito corrigido").toBe(6);
  });
});

test.describe("UX-08, UX-11 e RN-19: erros ao salvar, todos de uma vez", () => {
  test("UX-08/RN-19 (360×800): o cadastro vazio mostra os 4 erros de uma vez, nada sai, e o Nome recebe o foco inteiro à vista", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await login(page, env.admin);
    const dialog = await openNew(page);
    const calls = trackApi(page);
    const before = calls.length;
    await createButton(dialog).click();

    await expect(ERR(dialog, "name")).toHaveText("Informe o nome e o sobrenome.");
    await expect(ERR(dialog, "gender")).toHaveText("Informe o sexo.");
    await expect(ERR(dialog, "identification")).toContainText("Informe o e-mail, o celular ou o CPF.");
    await expect(ERR(dialog, "leader")).toHaveText('Escolha o líder ou desligue "Tem Liderança?".');
    await expect(dialog.getByText("Confira os campos destacados (4).")).toBeVisible();
    await expect(dialog.getByLabel("Nome *")).toBeFocused();
    expect(calls.length, "nenhuma requisição saiu").toBe(before);

    const input = await dialog.getByLabel("Nome *").boundingBox();
    const header = await dialog.getByRole("heading", { name: "Novo membro" }).boundingBox();
    const footer = await createButton(dialog).boundingBox();
    expect(input?.y ?? 0, "Nome não fica atrás do cabeçalho").toBeGreaterThanOrEqual((header?.y ?? 0) + (header?.height ?? 0));
    expect((input?.y ?? 0) + (input?.height ?? 0), "Nome não fica atrás do rodapé").toBeLessThanOrEqual(footer?.y ?? 0);
  });

  test("UX-08: o foco vai para o primeiro erro mesmo quando ele está abaixo da dobra e fica inteiro à vista (Líder, em 360×800)", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await login(page, env.admin);
    const dialog = await openNew(page);
    await dialog.getByLabel("Nome *").fill("Igor Teixeira");
    await dialog.getByRole("radio", { name: "Masculino" }).click();
    await dialog.getByLabel("Celular / WhatsApp").fill(free(1));
    await createButton(dialog).click();
    await expect(ERR(dialog, "leader")).toBeVisible();
    await expect(dialog.getByLabel("Líder *", { exact: true })).toBeFocused();
    const input = await dialog.getByLabel("Líder *", { exact: true }).boundingBox();
    const footer = await createButton(dialog).boundingBox();
    const header = await dialog.getByRole("heading", { name: "Novo membro" }).boundingBox();
    expect(input?.y ?? 0).toBeGreaterThanOrEqual((header?.y ?? 0) + (header?.height ?? 0));
    expect((input?.y ?? 0) + (input?.height ?? 0)).toBeLessThanOrEqual(footer?.y ?? 0);
  });

  test("UX-11 (cadastro): sem identificador, os três campos ficam inválidos e ligados à mensagem; um identificador válido a tira", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openNew(page);
    await fillBasics(dialog, who("Sem Identificador"));
    const calls = trackApi(page);
    await createButton(dialog).click();
    await expect(ERR(dialog, "identification")).toBeVisible();
    await expect(dialog.getByText("A pessoa entra no sistema com o celular, o e-mail ou o CPF. Informe pelo menos um.")).toHaveCount(0);
    for (const label of ["Celular / WhatsApp", "E-mail", "CPF"]) {
      const input = dialog.getByLabel(label);
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(input).toHaveAttribute("aria-describedby", /identification-error/);
    }
    await expect(dialog.getByLabel("Celular / WhatsApp")).toBeFocused();
    expect(functionPosts(calls)).toHaveLength(0);
    await dialog.getByLabel("E-mail").fill("alguem.qa6@example.com");
    await expect(ERR(dialog, "identification")).toHaveCount(0);
    for (const label of ["Celular / WhatsApp", "E-mail", "CPF"]) await expect(dialog.getByLabel(label)).not.toHaveAttribute("aria-invalid", "true");
    expect(created(who("Sem Identificador"))).toBe(0);
  });
});

test.describe("RN-02 a RN-08, RN-15, RN-16 e RN-19 pela tela (cadastro novo)", () => {
  /** Cada caso quebra uma regra de um cadastro que, fora isso, é válido; ao salvar, o erro fica no campo e nada é criado. */
  const cases: Array<{
    rn: string;
    name: string;
    fill: (dialog: Locator) => Promise<void>;
    errorId: string;
    message: string | RegExp;
  }> = [
    {
      rn: "RN-02",
      name: "nome sem sobrenome",
      fill: async (d) => d.getByLabel("Nome *").fill("Maria"),
      errorId: "name",
      message: "Informe o nome e o sobrenome.",
    },
    {
      rn: "RN-15",
      name: "nascimento futuro",
      fill: async (d) => d.getByLabel("Data de nascimento").fill("2099-01-01"),
      errorId: "birth_date",
      message: "A data de nascimento não pode ser futura.",
    },
    {
      rn: "RN-15",
      name: "nascimento com 100 anos ou mais",
      fill: async (d) => d.getByLabel("Data de nascimento").fill("1900-01-01"),
      errorId: "birth_date",
      message: "Confira a data de nascimento: a pessoa teria 100 anos ou mais.",
    },
    {
      rn: "RN-06",
      name: "celular ilegível",
      fill: async (d) => d.getByLabel("Celular / WhatsApp").fill("12345"),
      errorId: "mobile_whatsapp",
      message: "Celular inválido. Informe o DDD e o número.",
    },
    {
      rn: "RN-05",
      name: "e-mail fictício",
      fill: async (d) => d.getByLabel("E-mail").fill("lucia@mci12fakemail.com"),
      errorId: "email",
      message: "Este e-mail não pode ser usado. Informe um e-mail real ou deixe o campo em branco.",
    },
    {
      rn: "RN-04",
      name: "e-mail inválido",
      fill: async (d) => d.getByLabel("E-mail").fill("abc@x"),
      errorId: "email",
      message: "E-mail inválido. Confira o endereço digitado.",
    },
    {
      rn: "RN-07",
      name: "CPF inválido",
      fill: async (d) => d.getByLabel("CPF").fill("52998224726"),
      errorId: "cpf",
      message: "CPF inválido. Se a pessoa não tem CPF, deixe o campo em branco.",
    },
  ];

  for (const c of cases) {
    test(`${c.rn}: ${c.name} mostra o erro no campo e nada é criado`, async ({ page }) => {
      await login(page, env.admin);
      const dialog = await openNew(page);
      const personName = who(`Caso ${c.rn} ${c.name}`);
      await fillBasics(dialog, personName, free(2));
      await c.fill(dialog);
      const calls = trackApi(page);
      await createButton(dialog).click();
      await expect(ERR(dialog, c.errorId)).toContainText(c.message);
      await expect(dialog, "o formulário continua aberto").toBeVisible();
      expect(functionPosts(calls), "nenhuma chamada de cadastro").toHaveLength(0);
      expect(created(personName)).toBe(0);
    });
  }

  test("RN-03: sem escolher o sexo, o erro aparece e nada é criado", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openNew(page);
    await dialog.getByLabel("Nome *").fill(who("Sem Sexo"));
    await dialog.getByLabel("Celular / WhatsApp").fill(free(3));
    await dialog.getByRole("switch", { name: "Tem Liderança?" }).click();
    await createButton(dialog).click();
    await expect(ERR(dialog, "gender")).toHaveText("Informe o sexo.");
    expect(created(who("Sem Sexo"))).toBe(0);
  });

  test("RN-08: o cadastro só com o e-mail, só com o celular ou só com o CPF é aceito (um identificador basta)", async ({ page }) => {
    await login(page, env.admin);
    const options: Array<[string, (d: Locator) => Promise<void>]> = [
      ["Só Email", async (d) => d.getByLabel("E-mail").fill("so.email.qa6@example.com")],
      ["Só Cpf", async (d) => d.getByLabel("CPF").fill(FREE_CPF)],
    ];
    for (const [label, fill] of options) {
      const dialog = await openNew(page);
      const personName = who(label);
      await fillBasics(dialog, personName);
      await fill(dialog);
      await createButton(dialog).click();
      await expect(toast(page, "Membro criado com sucesso")).toBeVisible();
      await expect(dialog).toBeHidden();
      expect(created(personName)).toBe(1);
    }
  });

  test("RN-16: ligar 'Batizado(a)?', escolher a data e desligar avisa que a data será apagada e, salvo, grava sem data", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openNew(page);
    const personName = who("Batismo Desligado");
    await fillBasics(dialog, personName, free(4));
    await dialog.getByRole("switch", { name: "Batizado(a)?" }).click();
    await dialog.getByLabel("Data do batismo").fill("2020-05-10");
    await dialog.getByRole("switch", { name: "Batizado(a)?" }).click();
    await expect(dialog.getByText("Ao salvar, a data do batismo (10/05/2020) será apagada.")).toBeVisible();
    await createButton(dialog).click();
    await expect(toast(page, "Membro criado com sucesso")).toBeVisible();
    expect(sql(env, `SELECT concat_ws('|', is_baptized::text, coalesce(baptism_date::text, '<nulo>')) FROM public.members WHERE name = ${lit(personName)}`)).toBe("false|<nulo>");
  });
});

test.describe("UX-13, UX-14 e RN-09/RN-10: dado em uso", () => {
  test("UX-13/RN-09: e-mail de Caio e CPF de Diego mostram as duas mensagens, cada uma no campo, sem nome nem id de ninguém; mudar o e-mail tira só a dele", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openNew(page);
    const personName = who("Lúcia Nova");
    await fillBasics(dialog, personName, free(5));
    await dialog.getByLabel("E-mail").fill(M.caio.email);
    await dialog.getByLabel("CPF").fill(M.diego.cpf);
    const replies = trackCreateReplies(page);
    await createButton(dialog).click();

    await expect(ERR(dialog, "email")).toHaveText("Este e-mail já está sendo usado por outro cadastro.");
    await expect(ERR(dialog, "cpf")).toHaveText("Este CPF já está sendo usado por outro cadastro.");
    await expect(dialog.getByText("Já existe um membro com este e-mail, CPF ou celular.")).toHaveCount(0);
    await expect(dialog.getByText("Confira os campos destacados (2).")).toBeVisible();
    await expect(dialog.getByLabel("E-mail")).toBeFocused();
    await expect.poll(() => replies.length).toBeGreaterThan(0);

    const dom = await dialog.innerHTML();
    for (const secret of [M.caio.name, "Caio", id(M.caio.n), M.diego.name, "Diego", id(M.diego.n)]) {
      expect(dom, `formulário sem "${secret}"`).not.toContain(secret);
      for (const reply of replies) expect(reply.text, `resposta da rede sem "${secret}"`).not.toContain(secret);
    }
    expect(created(personName)).toBe(0);

    await dialog.getByLabel("E-mail").fill("lucia.nova.qa6@example.com");
    await expect(ERR(dialog, "email")).toHaveCount(0);
    await expect(ERR(dialog, "cpf")).toHaveText("Este CPF já está sendo usado por outro cadastro.");
  });

  test("RN-10: o celular de Caio sem o 9º dígito conta como o mesmo número e mostra a mensagem do celular", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openNew(page);
    await fillBasics(dialog, who("Nove Dígito"), "(51) 8888-6003");
    await createButton(dialog).click();
    await expect(ERR(dialog, "mobile_whatsapp")).toHaveText("Este celular já está sendo usado por outro cadastro.");
    expect(created(who("Nove Dígito"))).toBe(0);
  });

  test("UX-14: com o e-mail de Caio e o CPF de um excluído só aparece a recusa do e-mail; corrigido o e-mail, abre o aviso do cadastro excluído", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openNew(page);
    const personName = who("Com Dado De Excluído");
    await fillBasics(dialog, personName, free(6));
    await dialog.getByLabel("E-mail").fill(M.caio.email);
    await dialog.getByLabel("CPF").fill(M.lucia.cpf);
    await createButton(dialog).click();
    await expect(ERR(dialog, "email")).toHaveText("Este e-mail já está sendo usado por outro cadastro.");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    await dialog.getByLabel("E-mail").fill("com.excluido.qa6@example.com");
    await createButton(dialog).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(created(personName), "nada foi criado sem a confirmação").toBe(0);
  });
});

test.describe("UX-15, UX-16 e RN-11/RN-12: liderança no cadastro", () => {
  test("UX-15: 'Tem Liderança?' vem ligado e o Líder vazio; salvar sem líder mostra a mensagem no Líder, com o foco, sem chamar o servidor", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openNew(page);
    await expect(dialog.getByRole("switch", { name: "Tem Liderança?" })).toBeChecked();
    await expect(dialog.getByLabel("Líder *", { exact: true })).toHaveValue("");
    await fillBasics(dialog, who("Sem Líder Escolhido"), free(7), { leadership: true });
    const calls = trackApi(page);
    await createButton(dialog).click();
    await expect(ERR(dialog, "leader")).toHaveText('Escolha o líder ou desligue "Tem Liderança?".');
    await expect(dialog.getByLabel("Líder *", { exact: true })).toBeFocused();
    expect(functionPosts(calls)).toHaveLength(0);
    expect(created(who("Sem Líder Escolhido"))).toBe(0);
  });

  test("UX-15: com 'Tem Liderança?' desligado o Líder some, aparece 'A pessoa fica sem liderança.' e o cadastro é aceito; depois a conta entra pela sign-in (smoke)", async ({ page, browser }) => {
    await login(page, env.admin);
    const dialog = await openNew(page);
    const personName = who("Rita Sem Liderança");
    const mobile = free(20);
    await fillBasics(dialog, personName, mobile);
    await expect(dialog.getByRole("switch", { name: "Tem Liderança?" })).not.toBeChecked();
    await expect(dialog.getByLabel("Líder *", { exact: true })).toHaveCount(0);
    await expect(dialog.getByText("A pessoa fica sem liderança.")).toBeVisible();
    await createButton(dialog).click();
    await expect(toast(page, "Membro criado com sucesso")).toBeVisible();
    expect(sql(env, `SELECT concat_ws('|', has_leadership::text, coalesce(leader_id::text, '<nulo>'), mobile_whatsapp) FROM public.members WHERE name = ${lit(personName)}`)).toBe(`false|<nulo>|${mobile}`);

    // Smoke do login pela `sign-in`: o celular recém-cadastrado, com a senha inicial.
    const context = await browser.newContext();
    const guest = await context.newPage();
    await guest.goto("/login");
    await guest.getByLabel("Identificação").fill(`(51) ${mobile.slice(2, 7)}-${mobile.slice(7)}`);
    await guest.getByLabel("Senha", { exact: true }).fill("123456");
    await guest.locator('button[type="submit"]').click();
    // A conta nasce com a marca de troca (E2.03, RN-07): o login leva à troca obrigatória.
    await expect(guest).toHaveURL(/\/change-password$/);
    await context.close();
  });

  test("UX-16/RN-12: 'É Pastor(a)?' esconde 'Tem Liderança?' e o Líder, avisa quem deixa de ser o líder (status), devolve Pedro ao desligar e, salvo ligado, deixa Hugo pastor sem líder", async ({ page }) => {
    await login(page, env.admin);
    await page.goto(`/members?q=${encodeURIComponent(M.hugo.name)}`);
    await page.getByRole("button", { name: `Editar ${M.hugo.name}`, exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Editar membro" });
    await expect(dialog.getByLabel("Líder *", { exact: true })).toBeVisible();

    await dialog.getByRole("switch", { name: "É Pastor(a)?" }).click();
    await expect(dialog.getByRole("switch", { name: "Tem Liderança?" })).toHaveCount(0);
    await expect(dialog.getByLabel("Líder *", { exact: true })).toHaveCount(0);
    await expect(dialog.getByText("Pastor(a) não tem líder.")).toBeVisible();
    const notice = dialog.getByRole("status").filter({ hasText: `Ao salvar, ${M.pedro.name} deixa de ser o líder.` });
    await expect(notice).toBeVisible();

    await dialog.getByRole("switch", { name: "É Pastor(a)?" }).click();
    await expect(dialog.getByRole("switch", { name: "Tem Liderança?" })).toBeChecked();
    await expect(dialog.getByText(M.pedro.name).first()).toBeVisible();
    await expect(notice).toHaveCount(0);

    await dialog.getByRole("switch", { name: "É Pastor(a)?" }).click();
    await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(toast(page, "Membro atualizado com sucesso")).toBeVisible();
    expect(sql(env, `SELECT concat_ws('|', is_pastor::text, has_leadership::text, coalesce(leader_id::text, '<nulo>')) FROM public.members WHERE id = ${lit(id(M.hugo.n))}`)).toBe("true|false|<nulo>");
  });
});

test.describe("UX-25: envio e queda de conexão", () => {
  test("Durante o envio o botão mostra 'Criando…' e desabilita os dois botões, e um duplo toque gera uma chamada só", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openNew(page);
    const personName = who("Duplo Toque");
    await fillBasics(dialog, personName, free(8));
    let posts = 0;
    await page.route("**/functions/v1/create-user-admin", async (route) => {
      if (route.request().method() === "POST") {
        posts++;
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      await route.continue();
    });
    await createButton(dialog).click();
    const busy = dialog.getByRole("button", { name: "Criando…", exact: true });
    await expect(busy).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Cancelar", exact: true })).toBeDisabled();
    await busy.click({ force: true }).catch(() => undefined);
    await expect(toast(page, "Membro criado com sucesso")).toBeVisible();
    expect(posts, "uma chamada só").toBe(1);
    expect(created(personName)).toBe(1);
  });

  test("Sem conexão, a mensagem aparece no rodapé (role=alert), os dados ficam, e o botão volta e recebe o foco; com a conexão de volta, salva", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openNew(page);
    const personName = who("Sem Conexão");
    await fillBasics(dialog, personName, free(9));
    // Queda de conexão na chamada: com `context.setOffline` a requisição nunca sai (ver o relatório do QA).
    await page.route("**/functions/v1/create-user-admin", (route) => route.abort("internetdisconnected"));
    await createButton(dialog).click();
    const alert = dialog.getByRole("alert").filter({ hasText: "Não foi possível salvar o cadastro. Verifique a conexão e tente de novo." });
    await expect(alert).toBeVisible();
    await expect(dialog.getByLabel("Nome *")).toHaveValue(personName);
    await expect(createButton(dialog)).toBeEnabled();
    await expect(createButton(dialog)).toBeFocused();
    expect(created(personName)).toBe(0);

    await page.unroute("**/functions/v1/create-user-admin");
    await createButton(dialog).click();
    await expect(toast(page, "Membro criado com sucesso")).toBeVisible();
    expect(created(personName)).toBe(1);
  });

  test("Chamada que nunca responde: em cerca de 20 s o rodapé mostra o erro de conexão, os dados ficam e o botão volta", async ({ page }) => {
    test.setTimeout(75_000);
    await login(page, env.admin);
    const dialog = await openNew(page);
    const personName = who("Sem Resposta");
    await fillBasics(dialog, personName, free(10));
    // A requisição fica pendurada (nem resposta nem erro): quem encerra é o tempo-limite de 20 s do cliente.
    await page.route("**/functions/v1/create-user-admin", () => undefined);
    const startedAt = Date.now();
    await createButton(dialog).click();
    await expect(dialog.getByRole("button", { name: "Criando…", exact: true })).toBeDisabled();
    const alert = dialog.getByRole("alert").filter({ hasText: "Não foi possível salvar o cadastro. Verifique a conexão e tente de novo." });
    await expect(alert).toBeVisible({ timeout: 40_000 });
    const elapsed = Date.now() - startedAt;
    expect(elapsed, "não antes do tempo-limite").toBeGreaterThanOrEqual(19_000);
    expect(elapsed, "não muito depois do tempo-limite").toBeLessThan(30_000);
    await expect(dialog.getByLabel("Nome *")).toHaveValue(personName);
    await expect(createButton(dialog)).toBeEnabled();
    expect(created(personName)).toBe(0);
  });
});

test.describe("UX-27: axe nos estados de erro, nos dois temas", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`tema ${theme}: erros de campo (Nome, Sexo, Identificação, Líder) sem violação nas mensagens e nos campos`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await login(page, env.admin);
      const dialog = await openNew(page);
      await createButton(dialog).click();
      await expect(ERR(dialog, "name")).toBeVisible();
      await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
      await page.waitForTimeout(500); // as cores têm transição: o axe mede depois dela
      // O botão primário no tema escuro tem 2,97:1 (token --primary, de src/index.css): achado global, fora deste PR.
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .include('[role="dialog"]')
        .exclude('button[type="submit"]')
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
      // Nenhuma mensagem usa text-destructive como cor do texto.
      const colors = await dialog.evaluate((root) => {
        const probe = root.ownerDocument.createElement("span");
        probe.style.color = "hsl(var(--destructive))";
        root.appendChild(probe);
        const destructive = getComputedStyle(probe).color;
        probe.remove();
        return {
          destructive,
          messages: [...root.querySelectorAll<HTMLElement>("p[id$='-error'], p[id$='-warning']")].map((el) => ({ id: el.id, color: getComputedStyle(el).color })),
        };
      });
      expect(colors.messages.length).toBeGreaterThan(0);
      for (const m of colors.messages) expect(m.color, `${m.id}: o texto não usa a cor destructive`).not.toBe(colors.destructive);
    });
  }
});
