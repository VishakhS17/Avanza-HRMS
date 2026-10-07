import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SHIFT,
  computeDailyRecord,
  dayIsSettled,
  isMonthLocked,
  isWithinRegularizationWindow,
  validateRegularizationTimes,
  workDateForCheckIn,
  workDateForCheckOut,
  type DayLeave,
  type Punch,
  type ShiftRule,
} from "@/lib/services/attendance-rules";

const DAY: ShiftRule = DEFAULT_SHIFT;
const NIGHT: ShiftRule = { ...DEFAULT_SHIFT, startTime: "22:00", endTime: "06:00" };
const WEEKEND = ["SATURDAY", "SUNDAY"];
// 2026-10-05 is a Monday.
const MONDAY = "2026-10-05";
const TUESDAY = "2026-10-06";

function at(date: string, clock: string): Date {
  return new Date(`${date}T${clock}:00+05:30`);
}

function pair(date: string, inClock: string, outClock: string, mode: Punch["mode"] = "OFFICE", outDate = date): Punch[] {
  return [
    { type: "CHECK_IN", timestamp: at(date, inClock), mode },
    { type: "CHECK_OUT", timestamp: at(outDate, outClock), mode },
  ];
}

function compute(input: {
  workDate?: string;
  events?: Punch[];
  shift?: ShiftRule;
  holidays?: string[];
  leave?: DayLeave;
}) {
  return computeDailyRecord({
    workDate: input.workDate ?? MONDAY,
    events: input.events ?? [],
    shift: input.shift ?? DAY,
    weeklyOff: WEEKEND,
    holidayDates: input.holidays ?? [],
    leave: input.leave ?? null,
  });
}

describe("computeDailyRecord", () => {
  it("full day on time is PRESENT with no flags", () => {
    const result = compute({ events: pair(MONDAY, "09:30", "18:30") });
    assert.equal(result.status, "PRESENT");
    assert.deepEqual(result.flags, []);
    assert.equal(result.workedMinutes, 540);
    assert.equal(result.mode, "OFFICE");
  });

  it("holiday wins over punches", () => {
    const result = compute({ events: pair(MONDAY, "09:30", "18:30"), holidays: [MONDAY] });
    assert.equal(result.status, "HOLIDAY");
    assert.deepEqual(result.flags, []);
    assert.equal(result.workedMinutes, 540);
  });

  it("holiday without punches is HOLIDAY", () => {
    assert.equal(compute({ holidays: [MONDAY] }).status, "HOLIDAY");
  });

  it("weekly off is WEEKLY_OFF", () => {
    assert.equal(compute({ workDate: "2026-10-03" }).status, "WEEKLY_OFF");
    assert.equal(compute({ workDate: "2026-10-04", events: pair("2026-10-04", "10:00", "12:00") }).status, "WEEKLY_OFF");
  });

  it("holiday on a weekly off reads as HOLIDAY", () => {
    assert.equal(compute({ workDate: "2026-10-03", holidays: ["2026-10-03"] }).status, "HOLIDAY");
  });

  it("full-day leave is ON_LEAVE, even with punches", () => {
    assert.equal(compute({ leave: { portion: 1, session: null } }).status, "ON_LEAVE");
    assert.equal(
      compute({ leave: { portion: 1, session: null }, events: pair(MONDAY, "09:30", "18:30") }).status,
      "ON_LEAVE",
    );
  });

  it("holiday wins over leave", () => {
    assert.equal(compute({ holidays: [MONDAY], leave: { portion: 1, session: null } }).status, "HOLIDAY");
  });

  it("half-day leave plus half a day worked is HALF_DAY without late or early flags", () => {
    const result = compute({
      leave: { portion: 0.5, session: "FIRST" },
      events: pair(MONDAY, "14:00", "18:00"),
    });
    assert.equal(result.status, "HALF_DAY");
    assert.deepEqual(result.flags, []);
  });

  it("half-day leave with too little work is ABSENT", () => {
    const result = compute({ leave: { portion: 0.5, session: "SECOND" }, events: pair(MONDAY, "09:30", "11:00") });
    assert.equal(result.status, "ABSENT");
  });

  it("half-day leave with no punches is ABSENT", () => {
    assert.equal(compute({ leave: { portion: 0.5, session: "SECOND" } }).status, "ABSENT");
  });

  it("half-day leave with a missing check-out is INCOMPLETE", () => {
    const result = compute({
      leave: { portion: 0.5, session: "FIRST" },
      events: [{ type: "CHECK_IN", timestamp: at(MONDAY, "14:00"), mode: "OFFICE" }],
    });
    assert.equal(result.status, "INCOMPLETE");
    assert.deepEqual(result.flags, ["INCOMPLETE"]);
  });

  it("half the hours without leave is HALF_DAY with an early-exit flag", () => {
    const result = compute({ events: pair(MONDAY, "09:30", "14:00") });
    assert.equal(result.status, "HALF_DAY");
    assert.deepEqual(result.flags, ["EARLY_EXIT"]);
  });

  it("under half the hours is ABSENT", () => {
    assert.equal(compute({ events: pair(MONDAY, "09:30", "12:00") }).status, "ABSENT");
  });

  it("no punches on a working day is ABSENT", () => {
    const result = compute({});
    assert.equal(result.status, "ABSENT");
    assert.deepEqual(result.flags, []);
    assert.equal(result.firstIn, null);
  });

  it("missing check-out is INCOMPLETE with the INCOMPLETE flag", () => {
    const result = compute({ events: [{ type: "CHECK_IN", timestamp: at(MONDAY, "09:20"), mode: "OFFICE" }] });
    assert.equal(result.status, "INCOMPLETE");
    assert.deepEqual(result.flags, ["INCOMPLETE"]);
    assert.equal(result.workedMinutes, 0);
  });

  it("missing check-in is INCOMPLETE", () => {
    const result = compute({ events: [{ type: "CHECK_OUT", timestamp: at(MONDAY, "18:30"), mode: "OFFICE" }] });
    assert.equal(result.status, "INCOMPLETE");
    assert.ok(result.flags.includes("INCOMPLETE"));
  });

  it("a second check-in without a check-out is INCOMPLETE", () => {
    const events = [...pair(MONDAY, "09:30", "13:00"), { type: "CHECK_IN" as const, timestamp: at(MONDAY, "14:00"), mode: "OFFICE" as const }];
    assert.equal(compute({ events }).status, "INCOMPLETE");
  });

  it("late check-in past the grace is LATE; at the grace boundary it is not", () => {
    assert.deepEqual(compute({ events: pair(MONDAY, "09:46", "18:30") }).flags, ["LATE"]);
    assert.deepEqual(compute({ events: pair(MONDAY, "09:45", "18:30") }).flags, []);
  });

  it("leaving before the shift end is EARLY_EXIT but still PRESENT with full hours", () => {
    const result = compute({ events: pair(MONDAY, "09:00", "18:00") });
    assert.equal(result.status, "PRESENT");
    assert.deepEqual(result.flags, ["EARLY_EXIT"]);
  });

  it("late and early together", () => {
    const result = compute({ events: pair(MONDAY, "10:00", "17:00") });
    assert.equal(result.status, "HALF_DAY");
    assert.deepEqual(result.flags, ["LATE", "EARLY_EXIT"]);
  });

  it("WFH full day is WFH", () => {
    const result = compute({ events: pair(MONDAY, "09:30", "18:30", "WFH") });
    assert.equal(result.status, "WFH");
    assert.equal(result.mode, "WFH");
  });

  it("WFH half day is HALF_DAY with mode WFH", () => {
    const result = compute({ events: pair(MONDAY, "09:30", "14:00", "WFH") });
    assert.equal(result.status, "HALF_DAY");
    assert.equal(result.mode, "WFH");
  });

  it("multiple pairs count from the first check-in to the last check-out", () => {
    const events = [...pair(MONDAY, "18:00", "18:31"), ...pair(MONDAY, "09:30", "13:00")];
    const result = compute({ events });
    assert.equal(result.status, "PRESENT");
    assert.equal(result.workedMinutes, 541);
    assert.equal(result.firstIn?.toISOString(), at(MONDAY, "09:30").toISOString());
    assert.equal(result.lastOut?.toISOString(), at(MONDAY, "18:31").toISOString());
  });
});

describe("night shift", () => {
  it("full night is PRESENT on the start date", () => {
    const result = compute({ shift: NIGHT, events: pair(MONDAY, "22:00", "06:00", "OFFICE", TUESDAY) });
    assert.equal(result.status, "PRESENT");
    assert.deepEqual(result.flags, []);
    assert.equal(result.workedMinutes, 480);
  });

  it("late check-in is LATE", () => {
    const result = compute({ shift: NIGHT, events: pair(MONDAY, "22:30", "06:30", "OFFICE", TUESDAY) });
    assert.equal(result.status, "PRESENT");
    assert.deepEqual(result.flags, ["LATE"]);
  });

  it("leaving before 06:00 the next morning is EARLY_EXIT", () => {
    const result = compute({ shift: NIGHT, events: pair(MONDAY, "22:00", "05:00", "OFFICE", TUESDAY) });
    assert.deepEqual(result.flags, ["EARLY_EXIT"]);
    assert.equal(result.status, "HALF_DAY");
  });

  it("missing check-out is INCOMPLETE", () => {
    const result = compute({
      shift: NIGHT,
      events: [{ type: "CHECK_IN", timestamp: at(MONDAY, "22:00"), mode: "OFFICE" }],
    });
    assert.equal(result.status, "INCOMPLETE");
    assert.deepEqual(result.flags, ["INCOMPLETE"]);
  });

  it("a check-out at 02:00 closes the previous night instead of starting a new day", () => {
    const open = { workDate: MONDAY, timestamp: at(MONDAY, "22:00") };
    assert.equal(workDateForCheckOut(open, at(TUESDAY, "02:00"), NIGHT), MONDAY);
    assert.equal(workDateForCheckIn(at(TUESDAY, "02:00"), NIGHT), MONDAY);
    const result = compute({ shift: NIGHT, events: pair(MONDAY, "22:00", "02:00", "OFFICE", TUESDAY) });
    assert.equal(result.workedMinutes, 240);
    assert.equal(result.status, "HALF_DAY");
  });

  it("a check-in inside the early window belongs to that night", () => {
    assert.equal(workDateForCheckIn(at(MONDAY, "18:00"), NIGHT), MONDAY);
    assert.equal(workDateForCheckIn(at(MONDAY, "21:30"), NIGHT), MONDAY);
    assert.equal(workDateForCheckIn(at(TUESDAY, "05:59"), NIGHT), MONDAY);
  });

  it("holiday applies by the start date", () => {
    const events = pair(MONDAY, "22:00", "06:00", "OFFICE", TUESDAY);
    assert.equal(compute({ shift: NIGHT, events, holidays: [MONDAY] }).status, "HOLIDAY");
    assert.equal(compute({ shift: NIGHT, events, holidays: [TUESDAY] }).status, "PRESENT");
  });

  it("Friday night is a working night even though it ends on Saturday", () => {
    const result = compute({
      shift: NIGHT,
      workDate: "2026-10-02",
      events: pair("2026-10-02", "22:00", "06:00", "OFFICE", "2026-10-03"),
    });
    assert.equal(result.status, "PRESENT");
  });

  it("the day is not settled until after the morning check-out window", () => {
    assert.equal(dayIsSettled(MONDAY, NIGHT, at(TUESDAY, "00:30")), false);
    assert.equal(dayIsSettled(MONDAY, NIGHT, at(TUESDAY, "12:01")), true);
  });
});

describe("day shift punch dates", () => {
  it("check-ins stay on the calendar date", () => {
    assert.equal(workDateForCheckIn(at(MONDAY, "09:00"), DAY), MONDAY);
    assert.equal(workDateForCheckIn(at(MONDAY, "23:00"), DAY), MONDAY);
    assert.equal(workDateForCheckIn(at(MONDAY, "01:00"), DAY), MONDAY);
  });

  it("a check-out closes today's open check-in", () => {
    const open = { workDate: MONDAY, timestamp: at(MONDAY, "09:30") };
    assert.equal(workDateForCheckOut(open, at(MONDAY, "18:30"), DAY), MONDAY);
  });

  it("a check-in left open from a previous day cannot be closed the next afternoon", () => {
    const open = { workDate: MONDAY, timestamp: at(MONDAY, "09:30") };
    assert.equal(workDateForCheckOut(open, at(TUESDAY, "10:00"), DAY), null);
    assert.equal(workDateForCheckOut(null, at(TUESDAY, "10:00"), DAY), null);
  });

  it("settles after the evening check-out window", () => {
    assert.equal(dayIsSettled(MONDAY, DAY, at(MONDAY, "23:00")), false);
    assert.equal(dayIsSettled(MONDAY, DAY, at(TUESDAY, "00:31")), true);
  });
});

describe("lock and window", () => {
  it("a month locks after the 3rd of the next month", () => {
    assert.equal(isMonthLocked("2026-09-15", "2026-10-03"), false);
    assert.equal(isMonthLocked("2026-09-15", "2026-10-04"), true);
    assert.equal(isMonthLocked("2026-12-31", "2027-01-03"), false);
    assert.equal(isMonthLocked("2026-12-31", "2027-01-04"), true);
    assert.equal(isMonthLocked("2026-10-01", "2026-10-31"), false);
  });

  it("regularization is open for 7 days", () => {
    assert.equal(isWithinRegularizationWindow("2026-09-30", "2026-10-07"), true);
    assert.equal(isWithinRegularizationWindow("2026-09-29", "2026-10-07"), false);
    assert.equal(isWithinRegularizationWindow("2026-10-08", "2026-10-07"), false);
  });
});

describe("validateRegularizationTimes", () => {
  const now = at("2026-10-07", "12:00");

  it("accepts a normal day", () => {
    validateRegularizationTimes({
      workDate: MONDAY,
      requestedIn: at(MONDAY, "09:30"),
      requestedOut: at(MONDAY, "18:30"),
      shift: DAY,
      now,
    });
  });

  it("rejects out before in", () => {
    assert.throws(
      () =>
        validateRegularizationTimes({
          workDate: MONDAY,
          requestedIn: at(MONDAY, "18:30"),
          requestedOut: at(MONDAY, "09:30"),
          shift: DAY,
          now,
        }),
      /after check-in/,
    );
  });

  it("rejects a check-in on another date", () => {
    assert.throws(
      () =>
        validateRegularizationTimes({
          workDate: MONDAY,
          requestedIn: at(TUESDAY, "09:30"),
          requestedOut: at(TUESDAY, "18:30"),
          shift: DAY,
          now,
        }),
      /work date/,
    );
  });

  it("rejects a next-day check-out for a day shift", () => {
    assert.throws(
      () =>
        validateRegularizationTimes({
          workDate: MONDAY,
          requestedIn: at(MONDAY, "09:30"),
          requestedOut: at(TUESDAY, "01:00"),
          shift: DAY,
          now,
        }),
      /work date/,
    );
  });

  it("allows a next-morning check-out for a night shift", () => {
    validateRegularizationTimes({
      workDate: MONDAY,
      requestedIn: at(MONDAY, "22:00"),
      requestedOut: at(TUESDAY, "06:00"),
      shift: NIGHT,
      now,
    });
  });

  it("rejects future times", () => {
    assert.throws(
      () =>
        validateRegularizationTimes({
          workDate: "2026-10-07",
          requestedIn: at("2026-10-07", "09:30"),
          requestedOut: at("2026-10-07", "18:30"),
          shift: DAY,
          now,
        }),
      /future/,
    );
  });
});
