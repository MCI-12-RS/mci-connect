import { describe, it, expect } from "vitest";
import { normalizeSearch, toSearchPatterns } from "./search";

describe("toSearchPatterns (RN-04)", () => {
  it("ignora acentos e maiúsculas e exige cada palavra", () => {
    expect(toSearchPatterns("João SILVA")).toEqual(["%joao%", "%silva%"]);
    expect(toSearchPatterns("  joão   da  silva ")).toEqual(["%joao%", "%da%", "%silva%"]);
  });

  it("ignora pontuação nas pontas da palavra e trata a do meio como texto", () => {
    expect(toSearchPatterns("João (Silva)")).toEqual(["%joao%", "%silva%"]);
    expect(toSearchPatterns("a,b)")).toEqual(["%a,b%"]);
    expect(toSearchPatterns(`"x'y"`)).toEqual([`%x'y%`]);
    expect(toSearchPatterns("( ) ,")).toEqual([]);
  });

  it("escapa os curingas do LIKE e remove o * do PostgREST", () => {
    expect(toSearchPatterns("%")).toEqual(["%\\%%"]);
    expect(toSearchPatterns("a_b")).toEqual(["%a\\_b%"]);
    expect(toSearchPatterns("a\\b")).toEqual(["%a\\\\b%"]);
    expect(toSearchPatterns("jo*ao")).toEqual(["%joao%"]);
    expect(toSearchPatterns("*")).toEqual([]);
  });

  it("CPF e telefone valem pelos dígitos", () => {
    expect(toSearchPatterns("123.456.789-09")).toEqual(["%12345678909%"]);
    expect(toSearchPatterns("(51)99999-0000")).toEqual(["%51999990000%"]);
    expect(toSearchPatterns("rua 10")).toEqual(["%rua%", "%10%"]);
  });

  it("mantém e-mail como texto", () => {
    expect(toSearchPatterns("Ana@Mci.org")).toEqual(["%ana@mci.org%"]);
  });

  it("usa no máximo 5 palavras distintas dos primeiros 100 caracteres", () => {
    expect(toSearchPatterns("a b c d e f g")).toHaveLength(5);
    expect(toSearchPatterns("ana ana ANA")).toEqual(["%ana%"]);
    const long = "x".repeat(150);
    expect(toSearchPatterns(long)).toEqual([`%${"x".repeat(100)}%`]);
  });

  it("texto vazio não filtra", () => {
    expect(toSearchPatterns("")).toEqual([]);
    expect(toSearchPatterns("   ")).toEqual([]);
    expect(toSearchPatterns(null)).toEqual([]);
  });

  it("normaliza como o banco", () => {
    expect(normalizeSearch("ÇÃÉÎÕÜ")).toBe("caeiou");
  });
});
