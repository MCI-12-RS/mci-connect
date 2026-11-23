import { describe, it, expect } from "vitest";
import { PERMISSION_DENIED, isPermissionDenied, retryUnlessPermissionDenied } from "./errors";

const denied = { code: PERMISSION_DENIED, message: "Você não tem permissão para ver o dashboard." };
const otherError = { code: "PGRST116", message: "" };

describe("isPermissionDenied", () => {
  it("Dado um erro do banco com o código 42501, então é permissão negada", () => {
    expect(isPermissionDenied(denied)).toBe(true);
    expect(isPermissionDenied(Object.assign(new Error("x"), { code: "42501" }))).toBe(true);
  });

  it("Dado outro código, outro tipo de valor ou nenhum código, então não é permissão negada", () => {
    expect(isPermissionDenied(otherError)).toBe(false);
    expect(isPermissionDenied({ code: 42501 })).toBe(false);
    expect(isPermissionDenied(new Error("42501"))).toBe(false);
    expect(isPermissionDenied("42501")).toBe(false);
    expect(isPermissionDenied(null)).toBe(false);
    expect(isPermissionDenied(undefined)).toBe(false);
  });
});

describe("retryUnlessPermissionDenied", () => {
  it("Dada uma permissão negada, então não tenta de novo", () => {
    expect(retryUnlessPermissionDenied(0, denied)).toBe(false);
  });

  it("Dado outro erro, então tenta de novo até 3 vezes, como o padrão do TanStack Query", () => {
    expect([0, 1, 2, 3].map((failures) => retryUnlessPermissionDenied(failures, otherError))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});
