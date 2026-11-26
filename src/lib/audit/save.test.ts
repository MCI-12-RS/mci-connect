import { describe, expect, it } from "vitest";
import { unchangedOnServer } from "./save";

// AQ-7 do E2.05: o `updated_at` devolvido pelo PATCH, comparado com o carregado.
describe("unchangedOnServer (E2.05, AQ-7)", () => {
  const stamp = "2026-11-26T13:00:00.123456+00:00";

  it("Dado o mesmo updated_at, então nada mudou", () => {
    expect(unchangedOnServer(stamp, stamp)).toBe(true);
  });

  it("Dado o mesmo instante escrito de outro jeito, então nada mudou", () => {
    expect(unchangedOnServer("2026-11-26T13:00:00+00:00", "2026-11-26T10:00:00-03:00")).toBe(true);
    expect(unchangedOnServer("2026-11-26T13:00:00.5+00:00", "2026-11-26T13:00:00.500000Z")).toBe(true);
  });

  it("Dado um updated_at novo, então mudou, inclusive só nos microssegundos", () => {
    expect(unchangedOnServer(stamp, "2026-11-26T13:05:00.000001+00:00")).toBe(false);
    expect(unchangedOnServer(stamp, "2026-11-26T13:00:00.123457+00:00")).toBe(false);
  });

  it("Dado o registro só com o cadastro antes e depois (nulo), então nada mudou; a primeira alteração muda", () => {
    expect(unchangedOnServer(null, null)).toBe(true);
    expect(unchangedOnServer(null, stamp)).toBe(false);
  });

  it("Dada a linha sem a coluna (indefinida), então não compara: conta como mudança", () => {
    expect(unchangedOnServer(undefined, stamp)).toBe(false);
    expect(unchangedOnServer(undefined, null)).toBe(false);
  });
});
