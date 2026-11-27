// E2.11: a regra pura do formulário de relatório (oferta, visitantes,
// conferência, chamada, recusas, conferência antes de preencher e bloco da
// célula). Sem React e sem Supabase.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyReportError } from "./codes";
import { REPORT_LIMITS } from "./limits";
import { launchNoticeLines, toLaunchCheckState, type LaunchCheckRow } from "./launch-check";
import { formatOffering, maskTypedOffering, offeringValue, readPastedOffering } from "./offering";
import { automaticParticipants, participantsTotal, splitEditParticipants } from "./participants";
import { editPayload, isReportFormDirty, toSubmitParticipants, toSubmitReport, type StoredReport } from "./payload";
import { editSwitchNotice, launchLeavingNotice } from "./situation-switch";
import { cellBlockFromCell, cellBlockFromReport, cellOptionLines, reportLeaderLines } from "./snapshot";
import { validateReportForm, validateTimeOnBlur, type ReportFormValues } from "./validation";
import { visitorsCount, visitorsToSend } from "./visitors";

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../../../supabase/tests/fixtures/report-rules-cases.json"), "utf8"));

const values = (overrides: Partial<ReportFormValues> = {}): ReportFormValues => ({
  cellId: "c1",
  held: true,
  date: "2026-11-25",
  time: "20:00",
  theme: "A fé que vence",
  reason: "",
  participantIds: [],
  visitors: [""],
  offering: "50,00",
  observations: "",
  ...overrides,
});

const LAUNCH = { dates: { mode: "launch" as const, now: "2026-11-25 21:30:00", meeting: "2026-11-25 20:00:00" }, participantsTotal: 3 };

describe("DA-4/DA-5: os limites da tela são os do JSON", () => {
  it("REPORT_LIMITS = limits", () => {
    const l = fixture.limits;
    expect(REPORT_LIMITS).toEqual({
      theme: l.theme,
      reason: l.reason,
      observations: l.observations,
      visitorName: l.visitor_name,
      visitors: l.visitors,
      participants: l.participants,
      offeringMax: l.offering_max,
    });
  });
});

describe("P101, UX-24: a oferta (tabela da T6)", () => {
  it.each([
    ["", ""],
    ["0", "0,00"],
    ["5", "0,05"],
    ["50", "0,50"],
    ["5000", "50,00"],
    ["3750", "37,50"],
    ["123456", "1.234,56"],
    ["0005", "0,05"],
  ])("digitado %j mostra %j", (typed, shown) => {
    expect(maskTypedOffering(typed)).toBe(shown);
  });

  it.each([
    ["37,5", "37,50"],
    ["1.234,56", "1.234,56"],
    ["R$ 50,00", "50,00"],
    ["50", "50,00"],
    ["10,555", "10,56"],
    ["-5", "5,00"],
    ["abc", null],
  ])("colado %j mostra %j", (pasted, shown) => {
    expect(readPastedOffering(pasted)).toBe(shown);
  });

  it("o valor enviado: 3750 → 37.5; vazio não é zero; '0' é 0", () => {
    expect(offeringValue(maskTypedOffering("3750"))).toBe(37.5);
    expect(offeringValue("")).toBeNull();
    expect(offeringValue(maskTypedOffering("0"))).toBe(0);
    expect(formatOffering(50)).toBe("50,00");
  });
});

describe("RN-12, UX-23: visitantes", () => {
  it("espaços fora, vazios descartados, repetidos ficam, 'Silva, João' é um nome", () => {
    const names = ["  João   Silva ", "", "Maria", "Maria", "Silva, João"];
    expect(visitorsToSend(names)).toEqual(["João Silva", "Maria", "Maria", "Silva, João"]);
    expect(visitorsCount(names)).toBe(4);
  });

  it.each(fixture.visitors.filter((v: { input: unknown; code: string | null }) => Array.isArray(v.input) && !v.code).map((v: { id: string }) => [v.id, v]))(
    "%s: a mesma leitura do banco",
    (_id: string, v: { input: (string | null)[]; stored: string[] }) => {
      expect(visitorsToSend(v.input.map((name) => name ?? ""))).toEqual(v.stored);
    },
  );
});

describe("P22, RN-20: a conferência ao enviar", () => {
  it("UX-25: sem tema, sem oferta e com o horário '25:00': os três erros, na ordem da tela", () => {
    const errors = validateReportForm(values({ theme: "", offering: "", time: "25:00" }), LAUNCH);
    expect(errors.map((e) => [e.field, e.code])).toEqual([
      ["time", "report_time_invalid"],
      ["theme", "theme_required"],
      ["offering", "offering_required"],
    ]);
  });

  it("UX-04: sem célula, 'Escolha a célula.'", () => {
    expect(validateReportForm(values({ cellId: "" }), LAUNCH)[0]).toMatchObject({ field: "cell_id", message: "Escolha a célula." });
  });

  it("UX-19: tema e motivo só com espaços", () => {
    expect(validateReportForm(values({ theme: "   " }), LAUNCH).map((e) => e.code)).toEqual(["theme_required"]);
    expect(validateReportForm(values({ held: false, reason: "  " }), LAUNCH).map((e) => e.code)).toEqual(["reason_required"]);
  });

  it("RN-05 e RN-06 pelo 'agora' do servidor: o minuto exato e antes da reunião", () => {
    const at2030 = { ...LAUNCH, dates: { ...LAUNCH.dates, now: "2026-11-25 20:30:59" } };
    expect(validateReportForm(values({ time: "20:30" }), at2030)).toEqual([]);
    expect(validateReportForm(values({ time: "20:31" }), at2030).map((e) => [e.field, e.code])).toEqual([["time", "report_in_future"]]);
    expect(validateReportForm(values({ time: "19:59" }), at2030)[0].message).toBe(
      "O relatório não pode ser de antes da reunião da célula nesta semana (quarta, 25/11/2026, às 20:00).",
    );
  });

  it("RN-16: na edição, fora da semana do relatório", () => {
    const edit = { dates: { mode: "edit" as const, now: "2026-11-27 10:00:00", storedDate: "2026-11-18", storedTime: "20:00:00" }, participantsTotal: 3 };
    expect(validateReportForm(values({ date: "2026-11-19", time: "19:30" }), edit)).toEqual([]);
    expect(validateReportForm(values({ date: "2026-11-22" }), edit)[0]).toMatchObject({
      field: "date",
      message: "Na edição, a data só pode mudar dentro da semana do relatório, de 15/11/2026 a 21/11/2026.",
    });
  });

  it("os tetos (DA-4) e o limite de participantes (RN-10)", () => {
    const errors = validateReportForm(
      values({ theme: "a".repeat(301), observations: "o".repeat(4001), visitors: ["v".repeat(151)], offering: "100.000.000,00" }),
      { ...LAUNCH, participantsTotal: 1001 },
    );
    expect(errors.map((e) => e.code)).toEqual([
      "theme_too_long",
      "too_many_participants",
      "visitor_name_too_long",
      "offering_too_large",
      "observations_too_long",
    ]);
  });

  it("P62: ao sair do Horário, só o formato; vazio não dá erro", () => {
    expect(validateTimeOnBlur("")).toBeNull();
    expect(validateTimeOnBlur("19:60")?.code).toBe("report_time_invalid");
    expect(validateTimeOnBlur("19:30")).toBeNull();
  });
});

describe("Chamada pelo front", () => {
  it("UX-18, RN-09: 'Não houve célula' leva só a célula, a situação e o motivo, sem participantes", () => {
    const v = values({ held: false, reason: " Feriado ", participantIds: ["m1", "m2"], visitors: ["Ana"] });
    expect(toSubmitReport(v)).toEqual({ cell_id: "c1", was_held: false, reason_not_held: "Feriado" });
    expect(toSubmitParticipants(v)).toEqual([]);
  });

  it("RN-13, UX-23: a oferta é o número; os visitantes, lidos", () => {
    expect(toSubmitReport(values({ offering: "37,50", visitors: ["  João   Silva ", "", "Maria", "Maria"] }))).toEqual({
      cell_id: "c1",
      was_held: true,
      date: "2026-11-25",
      time: "20:00",
      theme: "A fé que vence",
      observations: null,
      visitors: ["João Silva", "Maria", "Maria"],
      offering: 37.5,
    });
  });

  const stored: StoredReport = {
    date: "2026-11-18",
    time: "20:00:00",
    was_held: true,
    theme: "A fé que vence",
    reason_not_held: null,
    observations: null,
    visitors: ["Ana"],
    offering: 50,
  };
  const opening = values({ date: "2026-11-18", time: "20:00", visitors: ["Ana"], participantIds: ["m4"] });

  it("UX-16, T5 do E2.05: a edição sem mudança não faz requisição; '20:00:00' é '20:00'", () => {
    expect(editPayload(stored, ["m1", "m2", "m3", "m4"], opening, ["m1", "m2", "m3", "m4"])).toBeNull();
  });

  it("o PATCH leva só o que mudou, e o conjunto final de participantes só se mudou", () => {
    expect(editPayload(stored, ["m1", "m2", "m3", "m4"], { ...opening, theme: "Outro" }, ["m1", "m2", "m3", "m4"])).toEqual({
      report: { theme: "Outro" },
      participantIds: null,
    });
    expect(editPayload(stored, ["m1", "m2", "m3", "m4"], opening, ["m1", "m2", "m3", "m5"])).toEqual({
      report: {},
      participantIds: ["m1", "m2", "m3", "m5"],
    });
  });

  it("RN-09: realizada → 'Não houve célula' leva a situação e o motivo; o contrário, a oferta", () => {
    expect(editPayload(stored, ["m1"], { ...opening, held: false, reason: "Chuva" }, [])).toEqual({
      report: { was_held: false, reason_not_held: "Chuva" },
      participantIds: null,
    });
    const notHeld: StoredReport = { ...stored, was_held: false, theme: null, offering: 0, visitors: [], reason_not_held: "Feriado" };
    const payload = editPayload(notHeld, [], values({ date: "2026-11-18", time: "20:00", theme: "Tema", offering: "0,00" }), ["m1", "m2", "m3"]);
    expect(payload?.report).toMatchObject({ was_held: true, theme: "Tema", offering: 0 });
    expect(payload?.participantIds).toEqual(["m1", "m2", "m3"]);
  });

  it("UX-31: a célula escolhida e a sugestão não contam como alteração", () => {
    const base = values({ theme: "", offering: "" });
    expect(isReportFormDirty(base, { ...base })).toBe(false);
    expect(isReportFormDirty(base, { ...base, theme: "x" })).toBe(true);
    expect(isReportFormDirty(base, { ...base, visitors: ["", ""] })).toBe(false);
  });
});

describe("P20: o que sai na troca de situação", () => {
  it("UX-18: no lançamento, o tema e os 2 participantes escolhidos", () => {
    expect(launchLeavingNotice({ theme: "Tema", participants: 2, visitors: 0, offering: null, observations: "" })).toBe(
      "Ao enviar, não serão enviados: o tema e 2 participantes escolhidos.",
    );
    expect(launchLeavingNotice({ theme: "Tema", participants: 0, visitors: 0, offering: null, observations: "" })).toBe(
      "Ao enviar, não será enviado: o tema.",
    );
    expect(launchLeavingNotice({ theme: "", participants: 0, visitors: 0, offering: null, observations: "" })).toBeNull();
  });

  it("UX-33: na edição, com tudo, e o texto da volta para a realizada", () => {
    expect(editSwitchNotice(true, false, { theme: "Tema", participants: 8, visitors: 2, offering: 50, observations: "Obs" })).toBe(
      "Ao salvar, saem do relatório: o tema, 8 participantes, 2 visitantes, a oferta (R$ 50,00) e as observações.",
    );
    expect(editSwitchNotice(true, false, { theme: "Tema", participants: 0, visitors: 0, offering: null, observations: "" })).toBe(
      "Ao salvar, sai do relatório: o tema.",
    );
    expect(editSwitchNotice(false, true, { theme: "", participants: 0, visitors: 0, offering: null, observations: "" })).toBe(
      "Ao salvar, o motivo sai do relatório, e o líder, o timóteo e o anfitrião registrados entram como participantes.",
    );
    expect(editSwitchNotice(true, true, { theme: "Tema", participants: 8, visitors: 2, offering: 50, observations: "" })).toBeNull();
  });
});

describe("RN-11, UX-20: participantes automáticos e total", () => {
  it("C4: Samuel, líder e timóteo, aparece uma vez; o total conta cada um uma vez", () => {
    const auto = automaticParticipants({
      leader_id: "s",
      leader_name: "Samuel Rocha",
      timothy_id: "s",
      timothy_name: "Samuel Rocha",
      host_id: "m",
      host_name: "Magda Rocha",
    });
    expect(auto).toEqual([
      { id: "s", name: "Samuel Rocha" },
      { id: "m", name: "Magda Rocha" },
    ]);
    expect(participantsTotal(["a", "c", "h"], ["l"])).toBe(4);
    expect(participantsTotal(["a", "c"], ["a", "x"], ["b"])).toBe(4);
  });

  it("T9: os registrados ficam fixos (o excluído só pelo nome); os excluídos, na linha do E2.01", () => {
    const split = splitEditParticipants(
      [
        { member_id: "a", member_name: "André", member_deleted: false, member_visible: true, is_snapshot_person: true },
        { member_id: "b", member_name: "Bruno", member_deleted: true, member_visible: true, is_snapshot_person: false },
        { member_id: "f", member_name: "Fábio", member_deleted: false, member_visible: true, member_is_active: false, is_snapshot_person: false },
      ],
      (p) => (p.member_is_active === false ? `${p.member_name} (inativo)` : p.member_name ?? ""),
    );
    expect(split.fixed).toEqual([{ id: "a", name: "André" }]);
    expect(split.kept).toEqual([{ id: "b", name: "Bruno" }]);
    expect(split.editable).toEqual([{ value: "f", label: "Fábio (inativo)" }]);
  });
});

describe("AQ-2, T7: as recusas do servidor", () => {
  const appError = (detail: object, message: string) => ({ code: "22023", message, details: JSON.stringify(detail), hint: "app_error" });

  it("date_time vai para o Horário; participant_ids leva o membro", () => {
    expect(classifyReportError(appError({ code: "report_in_future", field: "date_time" }, "Futuro."))).toEqual({
      kind: "field",
      field: "time",
      code: "report_in_future",
      message: "Futuro.",
      memberId: null,
    });
    expect(classifyReportError(appError({ code: "person_not_visible", field: "participant_ids", member_id: "m9" }, "Você só pode escolher pessoas que você vê."))).toMatchObject({
      field: "participant_ids",
      memberId: "m9",
    });
  });

  it("report_week_taken com a identificação para quem vê; meeting_not_yet e a semana no topo", () => {
    expect(
      classifyReportError(
        appError({ code: "report_week_taken", report: { id: "r2", date: "2026-11-25", time: "20:00:00", was_held: true, can_edit: true } }, "x"),
      ),
    ).toEqual({ kind: "week_taken", report: { id: "r2", date: "2026-11-25", time: "20:00:00", held: true, canEdit: true } });
    expect(classifyReportError(appError({ code: "meeting_not_yet", meeting_at: "2026-11-25T20:00" }, "Ainda não."))).toEqual({
      kind: "top",
      message: "Ainda não.",
    });
  });

  it("célula inativa, excluída, invisível; relatório sumido; técnico e rede", () => {
    expect(classifyReportError(appError({ code: "cell_inactive" }, "Inativa."))).toMatchObject({ kind: "cell", reason: "inactive" });
    expect(classifyReportError(appError({ code: "not_found_or_deleted", entity: "cell" }, "Não existe."))).toMatchObject({ kind: "cell", reason: "not_found" });
    expect(classifyReportError(appError({ code: "not_found_or_deleted", entity: "cell_report" }, "x"))).toMatchObject({ kind: "report_gone" });
    expect(classifyReportError(appError({ code: "report_id_conflict" }, "x"))).toEqual({ kind: "connection" });
    expect(classifyReportError({ code: "", message: "TypeError: Failed to fetch" })).toEqual({ kind: "connection" });
    expect(classifyReportError({ code: "23514", message: "violates check constraint" })).toEqual({ kind: "connection" });
  });

  // A tabela "Formato dos erros" da Solução técnica, linha a linha: o `detail` que o servidor manda e o destino na tela.
  const TABLE: ReadonlyArray<{ detail: Record<string, unknown>; expected: Record<string, unknown> }> = [
    { detail: { code: "cell_required", field: "cell_id" }, expected: { kind: "field", field: "cell_id" } },
    { detail: { code: "report_date_required", field: "date" }, expected: { kind: "field", field: "date" } },
    { detail: { code: "report_date_invalid", field: "date" }, expected: { kind: "field", field: "date" } },
    { detail: { code: "report_time_required", field: "time" }, expected: { kind: "field", field: "time" } },
    { detail: { code: "report_time_invalid", field: "time" }, expected: { kind: "field", field: "time" } },
    { detail: { code: "theme_required", field: "theme" }, expected: { kind: "field", field: "theme" } },
    { detail: { code: "theme_too_long", field: "theme", max: 300 }, expected: { kind: "field", field: "theme" } },
    { detail: { code: "reason_required", field: "reason_not_held" }, expected: { kind: "field", field: "reason_not_held" } },
    { detail: { code: "reason_too_long", field: "reason_not_held", max: 2000 }, expected: { kind: "field", field: "reason_not_held" } },
    {
      detail: { code: "not_held_with_deleted_participant", field: "was_held", member_ids: ["m1"] },
      expected: { kind: "field", field: "was_held" },
    },
    {
      detail: { code: "deleted_member_chosen", field: "participant_ids", member_id: "m1" },
      expected: { kind: "field", field: "participant_ids", memberId: "m1" },
    },
    {
      detail: { code: "person_not_visible", field: "participant_ids", member_id: "m2" },
      expected: { kind: "field", field: "participant_ids", memberId: "m2" },
    },
    {
      detail: { code: "deleted_participant_removal", field: "participant_ids", member_id: "m3" },
      expected: { kind: "field", field: "participant_ids", memberId: "m3" },
    },
    {
      detail: { code: "snapshot_participant_removal", field: "participant_ids", member_id: "m4" },
      expected: { kind: "field", field: "participant_ids", memberId: "m4" },
    },
    { detail: { code: "too_many_participants", field: "participant_ids", max: 1000 }, expected: { kind: "field", field: "participant_ids" } },
    { detail: { code: "visitors_invalid", field: "visitors" }, expected: { kind: "field", field: "visitors" } },
    { detail: { code: "too_many_visitors", field: "visitors", max: 1000 }, expected: { kind: "field", field: "visitors" } },
    { detail: { code: "visitor_name_too_long", field: "visitors", index: 0 }, expected: { kind: "field", field: "visitors" } },
    { detail: { code: "offering_required", field: "offering" }, expected: { kind: "field", field: "offering" } },
    { detail: { code: "offering_negative", field: "offering" }, expected: { kind: "field", field: "offering" } },
    { detail: { code: "offering_invalid", field: "offering" }, expected: { kind: "field", field: "offering" } },
    { detail: { code: "offering_too_large", field: "offering", max: 999999.99 }, expected: { kind: "field", field: "offering" } },
    { detail: { code: "observations_too_long", field: "observations", max: 4000 }, expected: { kind: "field", field: "observations" } },
    { detail: { code: "report_cell_immutable", cell_id: "c1" }, expected: { kind: "top" } },
    {
      detail: { code: "report_week_locked", field: "date", week_start: "2026-11-22", week_end: "2026-11-28" },
      expected: { kind: "field", field: "date" },
    },
    { detail: { code: "report_not_current_week", week_start: "2026-11-22", week_end: "2026-11-28" }, expected: { kind: "top" } },
    { detail: { code: "report_week_taken", week_start: "2026-11-22" }, expected: { kind: "week_taken", report: null } },
    { detail: { code: "meeting_not_yet", meeting_at: "2026-11-25T20:00" }, expected: { kind: "top" } },
    { detail: { code: "report_in_future", field: "date_time" }, expected: { kind: "field", field: "time" } },
    { detail: { code: "report_before_meeting", field: "date_time", meeting_at: "2026-11-25T20:00" }, expected: { kind: "field", field: "time" } },
    { detail: { code: "report_submit_not_allowed", cell_id: "c1" }, expected: { kind: "cell", reason: "not_allowed" } },
    { detail: { code: "not_found_or_deleted", entity: "cell" }, expected: { kind: "cell", reason: "not_found" } },
    { detail: { code: "not_found_or_deleted", entity: "cell_report" }, expected: { kind: "report_gone" } },
    { detail: { code: "cell_deleted", cell_id: "c1" }, expected: { kind: "cell", reason: "deleted" } },
    { detail: { code: "report_cell_deleted", cell_id: "c1" }, expected: { kind: "report_gone" } },
    { detail: { code: "cell_inactive", cell_id: "c1" }, expected: { kind: "cell", reason: "inactive" } },
    { detail: { code: "report_id_required" }, expected: { kind: "connection" } },
    { detail: { code: "report_id_conflict" }, expected: { kind: "connection" } },
    { detail: { code: "cell_meeting_day_missing" }, expected: { kind: "connection" } },
  ];

  it.each(TABLE)("$detail.code ($detail.field) vai para o destino da tabela", ({ detail, expected }) => {
    expect(classifyReportError(appError(detail, "Mensagem do servidor."))).toMatchObject(expected);
  });

  it("as reservas: 42501, 23505 sem código e 40P01", () => {
    expect(classifyReportError({ code: "42501", message: "permission denied" })).toMatchObject({ kind: "permission" });
    expect(classifyReportError({ code: "23505", message: "duplicate key" })).toEqual({ kind: "week_taken", report: null });
    expect(classifyReportError({ code: "40P01", message: "deadlock detected" })).toEqual({ kind: "connection" });
  });
});

describe("RN-19, T3: a conferência antes de preencher", () => {
  const row = (overrides: Partial<LaunchCheckRow>): LaunchCheckRow => ({
    status: "can_submit",
    server_now: "2026-11-26T00:30:00Z",
    today: "2026-11-25",
    week_start: "2026-11-22",
    week_end: "2026-11-28",
    meeting_date: "2026-11-25",
    meeting_time: "20:00:00",
    allowed_dates: ["2026-11-25"],
    existing_report_id: null,
    existing_date: null,
    existing_time: null,
    existing_was_held: null,
    existing_can_edit: null,
    ...overrides,
  });

  it("can_submit traz as datas; already_sent, a identificação para quem vê", () => {
    expect(toLaunchCheckState(row({}))).toMatchObject({ kind: "ready", context: { meeting: "2026-11-25 20:00:00", allowedDates: ["2026-11-25"] } });
    const sent = toLaunchCheckState(
      row({ status: "already_sent", existing_report_id: "r2", existing_date: "2026-11-25", existing_time: "20:00:00", existing_was_held: true, existing_can_edit: false }),
    );
    expect(sent.kind === "notice" && launchNoticeLines(sent.notice, false)).toEqual([
      "O relatório para esta semana já foi enviado.",
      "Reunião de quarta, 25/11/2026, às 20:00 · Célula realizada.",
    ]);
  });

  it("not_yet com o momento, inativa com a orientação, sem resposta = falha", () => {
    const notYet = toLaunchCheckState(row({ status: "not_yet" }));
    expect(notYet.kind === "notice" && launchNoticeLines(notYet.notice, false)).toEqual([
      "A reunião desta semana ainda não aconteceu. O relatório pode ser enviado a partir de quarta, 25/11/2026, às 20:00.",
    ]);
    const inactive = toLaunchCheckState(row({ status: "cell_inactive" }));
    expect(inactive.kind === "notice" && launchNoticeLines(inactive.notice, true)[0]).toContain("reative a célula");
    expect(toLaunchCheckState(undefined)).toEqual({ kind: "failed" });
  });
});

describe("P105, RN-17, T10: o bloco da célula e a opção do seletor", () => {
  const cell = {
    id: "c1",
    leader_id: "a",
    leader_name: "André Souza",
    timothy_id: "f",
    timothy_name: "Fábio Lima",
    host_id: "b",
    host_name: "Beatriz",
    type: "Evangelística",
    meeting_day: "Quarta",
    meeting_time: "20:00:00",
    street: "Rua das Flores",
    number: "100",
    neighborhood: "Centro",
    g12_leader_name: "Pedro Alves",
    leader_g12_level: 2,
    leader_is_pastor: false,
  };

  it("UX-06: as linhas, com a marca de inativo só para quem quem lança vê", () => {
    const block = cellBlockFromCell(cell, (id) => (id === "f" ? { is_active: false, gender: "M" } : null));
    expect(block.lines.map((l) => [l.label, l.value])).toEqual([
      ["Líder", "André Souza"],
      ["Timóteo", "Fábio Lima (inativo)"],
      ["Anfitrião", "Beatriz"],
      ["G12", "Pedro Alves"],
      ["Tipo", "Evangelística"],
      ["Dia e horário", "Quarta, 20:00"],
      ["Endereço", "Rua das Flores, 100 · Centro"],
    ]);
    expect(block.snapshot).toBe(false);
  });

  it("Pastores, sem endereço e o retrato com a frase", () => {
    const pastor = cellBlockFromCell({ ...cell, leader_is_pastor: true, leader_g12_level: 0, street: null, number: null, neighborhood: null });
    expect(pastor.lines[3].value).toBe("Pastores");
    expect(pastor.lines[6]).toMatchObject({ value: "Sem endereço", empty: "address" });
    const snap = cellBlockFromReport({ snapshot_leader_name: "André Souza", snapshot_timothy_name: "Caio Lima", snapshot_cell_type: "Evangelística", cell_meeting_day: "Quinta", cell_meeting_time: "20:00:00" });
    expect(snap.snapshot).toBe(true);
    expect(snap.lines[1].value).toBe("Caio Lima");
    expect(snap.lines[5].value).toBe("Quinta, 20:00");
  });

  it("a opção em duas linhas e o líder registrado na lista", () => {
    expect(cellOptionLines(cell)).toEqual({ title: "André Souza · Quarta, 20:00", description: "G12: Pedro Alves · Rua das Flores, 100 · Centro" });
    expect(reportLeaderLines({ snapshot_leader_name: "Samuel Rocha", snapshot_leader_is_pastor: true, snapshot_leader_g12_level: 0 })).toEqual({
      leader: "Samuel Rocha",
      g12: "Pastores",
      g12None: false,
    });
  });
});
