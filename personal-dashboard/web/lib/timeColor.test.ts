import { describe, it, expect } from "vitest";
import { timeColorState, formatRemaining } from "./timeColor";

const MIN = 60_000;
const HOUR = 60 * MIN;

describe("timeColorState", () => {
  it("returns 'normal' when remaining > 1h", () => {
    expect(timeColorState(HOUR + 1)).toBe("normal");
  });

  it("returns 'yellow' at exactly 1h", () => {
    expect(timeColorState(HOUR)).toBe("yellow");
  });

  it("returns 'yellow' at 11 minutes", () => {
    expect(timeColorState(11 * MIN)).toBe("yellow");
  });

  it("returns 'yellow' at 10min + 1ms", () => {
    expect(timeColorState(10 * MIN + 1)).toBe("yellow");
  });

  it("returns 'blink' at exactly 10 minutes", () => {
    expect(timeColorState(10 * MIN)).toBe("blink");
  });

  it("returns 'blink' at 1 second", () => {
    expect(timeColorState(1_000)).toBe("blink");
  });

  it("returns 'blink' at 1ms", () => {
    expect(timeColorState(1)).toBe("blink");
  });

  it("returns 'red' at exactly 0", () => {
    expect(timeColorState(0)).toBe("red");
  });

  it("returns 'red' at -1ms", () => {
    expect(timeColorState(-1)).toBe("red");
  });

  it("returns 'red' at -1h", () => {
    expect(timeColorState(-HOUR)).toBe("red");
  });
});

describe("formatRemaining", () => {
  it("formats 2h30m as '2時間30分'", () => {
    expect(formatRemaining(2 * HOUR + 30 * MIN)).toBe("2時間30分");
  });

  it("formats exactly 1h as '1時間0分'", () => {
    expect(formatRemaining(HOUR)).toBe("1時間0分");
  });

  it("formats 45m as '45分'", () => {
    expect(formatRemaining(45 * MIN)).toBe("45分");
  });

  it("formats 1 second as '0分'", () => {
    expect(formatRemaining(1_000)).toBe("0分");
  });

  it("formats 0 as '終了'", () => {
    expect(formatRemaining(0)).toBe("終了");
  });

  it("formats -1h as '終了'", () => {
    expect(formatRemaining(-HOUR)).toBe("終了");
  });
});
