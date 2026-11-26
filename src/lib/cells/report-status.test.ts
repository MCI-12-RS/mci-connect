import { describe, expect, it } from "vitest";
import { Constants } from "@/integrations/supabase/types";
import {
  REPORT_STATUS_LEGEND,
  REPORT_STATUS_TEXTS,
  isCellReportStatus,
  missingWeeksLine,
  missingWeeksText,
  reportStatusDisplay,
} from "./report-status";

// E2.09: P70, P72, P73; UX-04, UX-08 e UX-12 (o front só traduz o código).

describe("UX-04, P70: cada código do servidor vira texto, tom e ícone", () => {
  it.each([
    ["sent_held", "Enviado · Célula realizada", "Enviado, Célula realizada", "success", "check"],
    ["sent_not_held", "Enviado · Não houve célula", "Enviado, Não houve célula", "success", "check"],
    ["not_yet", "Ainda não ocorreu", "Ainda não ocorreu", "muted", "clock"],
    ["pending", "Pendente", "Pendente", "warning", "alert"],
    ["next_week", "Conta a partir da próxima semana", "Conta a partir da próxima semana", "muted", "calendar-clock"],
  ])("%s → '%s'", (status, label, srLabel, tone, icon) => {
    expect(reportStatusDisplay(status, true)).toMatchObject({ kind: "badge", status, label, srLabel, tone, icon });
  });

  it("RN-07: 'Sem dia da reunião' é texto, sem badge", () => {
    expect(reportStatusDisplay("no_meeting_day", true)).toEqual({ kind: "text", label: "Sem dia da reunião" });
  });

  it("RN-01: a célula inativa (código nulo) não tem situação", () => {
    expect(reportStatusDisplay(null, false)).toEqual({ kind: "inactive" });
  });

  it("UX-08: código ausente numa célula ativa ou código desconhecido viram 'indisponível'", () => {
    expect(reportStatusDisplay(null, true)).toEqual({ kind: "unknown" });
    expect(reportStatusDisplay(undefined, null)).toEqual({ kind: "unknown" });
    expect(reportStatusDisplay("recess", true)).toEqual({ kind: "unknown" });
    expect(reportStatusDisplay(3, true)).toEqual({ kind: "unknown" });
  });

  it("UX-12: o código manda, nunca o is_active nem a data do aparelho", () => {
    expect(reportStatusDisplay("pending", false)).toMatchObject({ kind: "badge", label: "Pendente" });
    expect(reportStatusDisplay("not_yet", null)).toMatchObject({ kind: "badge", label: "Ainda não ocorreu" });
  });

  it("todo valor do enum é conhecido, e nada além dele", () => {
    for (const status of Constants.public.Enums.cell_report_status) expect(isCellReportStatus(status)).toBe(true);
    expect(isCellReportStatus("Pendente")).toBe(false);
    expect(isCellReportStatus(null)).toBe(false);
  });
});

describe("UX-04, P72: as semanas anteriores sem relatório", () => {
  it.each([
    [0, null],
    [null, null],
    [1, "Sem relatório na semana passada"],
    [2, "Sem relatório nas 2 semanas anteriores"],
    [3, "Sem relatório nas 3 semanas anteriores"],
    [4, "Sem relatório nas 4 ou mais semanas anteriores"],
    [7, "Sem relatório nas 4 ou mais semanas anteriores"],
  ])("%s → %s", (weeks, text) => {
    expect(missingWeeksText(weeks)).toBe(text);
  });

  it("valores fora do contrato não viram texto", () => {
    expect(missingWeeksText(-1)).toBeNull();
    expect(missingWeeksText(1.5)).toBeNull();
    expect(missingWeeksText(undefined)).toBeNull();
  });

  it("a linha só acompanha um badge que não seja 'Enviado'", () => {
    expect(missingWeeksLine(reportStatusDisplay("pending", true), 2)).toBe("Sem relatório nas 2 semanas anteriores");
    expect(missingWeeksLine(reportStatusDisplay("not_yet", true), 3)).toBe("Sem relatório nas 3 semanas anteriores");
    expect(missingWeeksLine(reportStatusDisplay("sent_held", true), 2)).toBeNull();
    expect(missingWeeksLine(reportStatusDisplay("sent_not_held", true), 1)).toBeNull();
    expect(missingWeeksLine(reportStatusDisplay("no_meeting_day", true), 2)).toBeNull();
    expect(missingWeeksLine(reportStatusDisplay(null, false), 2)).toBeNull();
    expect(missingWeeksLine(reportStatusDisplay("recess", true), 2)).toBeNull();
  });
});

describe("P73: a legenda", () => {
  it("explica os cinco badges, na ordem da RN-04, mais as semanas e o rodapé", () => {
    expect(REPORT_STATUS_LEGEND.statuses.map((e) => e.status)).toEqual([
      "sent_held",
      "sent_not_held",
      "not_yet",
      "pending",
      "next_week",
    ]);
    expect(REPORT_STATUS_LEGEND.toggle).toBe("Entenda a situação do relatório");
    expect(REPORT_STATUS_LEGEND.footer).toBe(
      "A semana vai de domingo a sábado. A situação é a do momento em que a lista foi carregada.",
    );
  });

  it("UX-04: nenhum texto usa os termos proibidos", () => {
    const all = JSON.stringify({ REPORT_STATUS_LEGEND, REPORT_STATUS_TEXTS }) +
      Constants.public.Enums.cell_report_status
        .map((s) => {
          const d = reportStatusDisplay(s, true);
          return d.kind === "badge" || d.kind === "text" ? d.label : "";
        })
        .join(" ") +
      [1, 2, 3, 4].map(missingWeeksText).join(" ");
    expect(all).not.toMatch(/Status|Atrasado|Entregue|Cancelada|Sem relatório a |cobr/);
  });
});
