import { beforeEach, describe, expect, it } from "vitest";
import { clearReturnPosition, readReturnPosition, sessionStore, writeReturnPosition } from "./return-position";

describe("return-position (E2.14, DA-4)", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("grava, lê e apaga por tela", () => {
    const store = sessionStore();
    writeReturnPosition(store, "dashboard", { key: "members_total", y: 640 });
    writeReturnPosition(store, "cells", { key: "c-1", y: 0 });
    expect(readReturnPosition(store, "dashboard")).toEqual({ key: "members_total", y: 640 });
    expect(readReturnPosition(store, "cells")).toEqual({ key: "c-1", y: 0 });
    clearReturnPosition(store, "dashboard");
    expect(readReturnPosition(store, "dashboard")).toBeNull();
    expect(readReturnPosition(store, "cells")).not.toBeNull();
  });

  it.each(["{", "null", '{"key":"","y":1}', '{"key":"a","y":-1}', '{"key":"a","y":"10"}', '"texto"'])(
    "ignora e apaga o valor inválido %s",
    (raw) => {
      window.sessionStorage.setItem("mci:return-position:dashboard", raw);
      expect(readReturnPosition(sessionStore(), "dashboard")).toBeNull();
      expect(window.sessionStorage.getItem("mci:return-position:dashboard")).toBeNull();
    },
  );

  it("sem armazenamento, não falha", () => {
    expect(readReturnPosition(null, "dashboard")).toBeNull();
    expect(() => writeReturnPosition(null, "dashboard", { key: "a", y: 1 })).not.toThrow();
  });
});
