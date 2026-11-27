// E2.11 (DT-17, AQ-6): as regras de data da tela contra a mesma tabela de casos
// do pgTAP (report-rules-cases.json), no fuso que o caso pede.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dayOption,
  editDates,
  editRule,
  launchDates,
  launchDatesAt,
  launchRule,
  launchStatus,
  meetingAt,
  meetingInSentence,
  serverClock,
  spLocalMoment,
  suggestedLaunch,
  weekStart,
} from "./dates";

interface LaunchCase {
  id: string;
  now: string;
  meeting_day: string;
  meeting_time: string;
  was_held: boolean;
  date: string | null;
  time: string | null;
  week_has_report: boolean;
  expected: {
    week_start: string;
    week_end: string;
    meeting_at: string;
    status: string;
    allowed_dates: string[];
    suggested: { date: string; time: string } | null;
    code: string | null;
    final: string;
  };
}
interface EditCase {
  id: string;
  now: string;
  stored_date: string;
  date: string;
  time: string;
  moment_changed: boolean;
  expected: { allowed_dates: string[]; code: string | null };
}

const cases: { launch: LaunchCase[]; edit: EditCase[] } = JSON.parse(
  readFileSync(resolve(__dirname, "../../../supabase/tests/fixtures/report-rules-cases.json"), "utf8"),
);

describe("E2.11: lançamento pela tabela de casos (RN-04 a RN-07, RN-09, RN-18, RN-19)", () => {
  it.each(cases.launch.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const now = spLocalMoment(new Date(c.now));
    const week = weekStart(now.slice(0, 10));
    const meeting = meetingAt(week, c.meeting_day, c.meeting_time);
    expect(meeting).not.toBeNull();
    if (!meeting) return;
    expect(week).toBe(c.expected.week_start);
    expect(meeting.slice(0, 16).replace(" ", "T")).toBe(c.expected.meeting_at);
    expect(launchStatus(now, meeting, c.week_has_report)).toBe(c.expected.status);
    expect(launchDates(now, meeting)).toEqual(c.expected.allowed_dates);
    const rule = launchRule({
      now,
      meeting,
      held: c.was_held,
      date: c.date ?? "",
      time: c.time ?? "",
      weekHasReport: c.week_has_report,
    });
    expect(rule.code).toBe(c.expected.code);
    expect(`${rule.finalDate} ${rule.finalTime.slice(0, 5)}`).toBe(c.expected.final);
    if (c.expected.suggested) {
      const dates = launchDatesAt(new Date(c.now), c.meeting_day, c.meeting_time);
      expect(dates && suggestedLaunch(dates)).toEqual(c.expected.suggested);
    }
  });
});

describe("E2.11: edição pela tabela de casos (RN-05, RN-16)", () => {
  it.each(cases.edit.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const now = spLocalMoment(new Date(c.now));
    expect(editDates(now, c.stored_date)).toEqual(c.expected.allowed_dates);
    expect(editRule({ now, storedDate: c.stored_date, date: c.date, time: c.time, momentChanged: c.moment_changed })).toBe(
      c.expected.code,
    );
  });
});

describe("E2.11: o relógio e os textos de data", () => {
  it("AQ-6: o 'agora' é o do servidor mais o tempo passado no aparelho", () => {
    let elapsed = 1_000;
    const clock = serverClock("2026-11-25T23:30:00Z", () => elapsed);
    expect(clock().toISOString()).toBe("2026-11-25T23:30:00.000Z");
    elapsed += 61_000;
    expect(clock().toISOString()).toBe("2026-11-25T23:31:01.000Z");
  });

  it("UX-10: o aparelho em Lisboa e em Manaus vê as datas de Brasília", () => {
    // Quarta, 00:30 em Lisboa = terça, 21:30 em Brasília: a reunião de quarta ainda não aconteceu.
    expect(spLocalMoment(new Date("2026-11-25T00:30:00Z"))).toBe("2026-11-24 21:30:00");
    const manaus = launchDatesAt(new Date("2026-11-25T23:30:00Z"), "Quarta", "20:00");
    expect(manaus?.allowedDates).toEqual(["2026-11-25"]);
    expect(manaus && suggestedLaunch(manaus)).toEqual({ date: "2026-11-25", time: "20:00" });
  });

  it("P104: a opção da data e o momento numa frase", () => {
    expect(dayOption("2026-11-25", "2026-11-27", " (hoje)")).toBe("Quarta, 25/11/2026");
    expect(dayOption("2026-11-27", "2026-11-27", " (hoje)")).toBe("Sexta, 27/11/2026 (hoje)");
    expect(meetingInSentence("2026-11-25", "20:00:00")).toBe("quarta, 25/11/2026, às 20:00");
  });
});
