import { describe, expect, it } from "vitest";
import { sectionView, type SectionInput } from "./section-state";

const base: SectionInput = { hasData: false, isError: false, isFetching: false, invalidatedByWrite: false, retried: false };

describe("sectionView (T7, RN-17, DA-3)", () => {
  it("sem dados e sem erro: carregando", () => {
    expect(sectionView({ ...base, isFetching: true })).toEqual({ kind: "loading" });
  });

  it("sem dados e com erro: erro, sem anunciar na primeira carga", () => {
    expect(sectionView({ ...base, isError: true })).toEqual({ kind: "error", retrying: false, announce: false });
  });

  it("durante 'Tentar de novo', o botão fica ocupado; a falha depois dele é anunciada", () => {
    expect(sectionView({ ...base, isError: true, isFetching: true })).toEqual({ kind: "error", retrying: true, announce: false });
    expect(sectionView({ ...base, isError: true, retried: true })).toEqual({ kind: "error", retrying: false, announce: true });
  });

  it("com dados e erro depois de uma gravação: erro, e não o número de antes (RN-17)", () => {
    expect(sectionView({ ...base, hasData: true, isError: true, invalidatedByWrite: true }).kind).toBe("error");
  });

  it("com dados e erro sem gravação (voltar para a aba): mantém os números", () => {
    expect(sectionView({ ...base, hasData: true, isError: true })).toEqual({ kind: "ready", updating: false });
  });

  it("com dados, buscando de novo: em atualização (P44)", () => {
    expect(sectionView({ ...base, hasData: true, isFetching: true, invalidatedByWrite: true })).toEqual({ kind: "ready", updating: true });
    expect(sectionView({ ...base, hasData: true })).toEqual({ kind: "ready", updating: false });
  });
});
