import { describe, expect, it } from "vitest";
import { isUuid, oneOf, readListParam, setParam, splitList, writeList } from "./url";

const OPTIONS = ["a", "b", "c"] as const;
const isOption = oneOf(OPTIONS);

describe("listas na URL (E2.07, P50, RN-14)", () => {
  it("separa por vírgula, sem vazios nem espaços nas pontas", () => {
    expect(splitList(" a, ,b,, c ")).toEqual(["a", "b", "c"]);
  });

  it("com a ordem das opções: sem repetidos e sem desconhecidos", () => {
    const params = new URLSearchParams("x=c,a,zz,a");
    expect(readListParam(params, "x", isOption, OPTIONS)).toEqual(["a", "c"]);
  });

  it("sem ordem (a Liderança): a ordem em que vieram, sem repetidos", () => {
    const params = new URLSearchParams("x=c,a,c,b");
    expect(readListParam(params, "x", isOption)).toEqual(["c", "a", "b"]);
  });

  it("parâmetro ausente: lista vazia", () => {
    expect(readListParam(new URLSearchParams(), "x", isOption, OPTIONS)).toEqual([]);
  });

  it("vazio sai da URL; o resto é gravado", () => {
    const params = new URLSearchParams("x=1&y=2");
    setParam(params, "x", writeList([]));
    setParam(params, "y", null);
    setParam(params, "z", writeList(["a", "b"]));
    expect(params.has("x")).toBe(false);
    expect(params.has("y")).toBe(false);
    expect(params.get("z")).toBe("a,b");
  });

  it("isUuid: só o formato do id", () => {
    expect(isUuid("e2e207f1-0001-0000-0000-000000000001")).toBe(true);
    expect(isUuid("nao-e-id")).toBe(false);
  });
});
