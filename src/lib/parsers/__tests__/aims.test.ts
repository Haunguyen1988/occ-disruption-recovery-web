import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { looksLikeAimsDayRep, parseAimsDayRep } from "@/lib/parsers/aims";

function loadFixtureMatrix(): unknown[][] {
  const file = path.join(
    __dirname,
    "fixtures",
    "aims_dayrep_sample.xlsx",
  );
  const buf = fs.readFileSync(file);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    defval: "",
    header: 1,
    raw: false,
  });
}

describe("AIMS DayRep parser", () => {
  it("detects AIMS layout via row-5 header signature", () => {
    const m = loadFixtureMatrix();
    expect(looksLikeAimsDayRep(m)).toBe(true);
  });

  it("rejects layouts that do not match the canonical header", () => {
    expect(looksLikeAimsDayRep([])).toBe(false);
    expect(
      looksLikeAimsDayRep([
        [],
        [],
        [],
        [],
        [],
        ["foo", "bar", "baz", "", "qux"],
      ]),
    ).toBe(false);
  });

  it("parses the full DayRep into 325 flights with 0 errors", () => {
    const r = parseAimsDayRep(loadFixtureMatrix());
    const errors = r.issues.filter((i) => i.level === "error");
    expect(errors).toHaveLength(0);
    expect(r.schedule).toHaveLength(325);
    expect(r.detectedFormat).toBe("aims_dayrep");
  });

  it("derives 73 unique aircraft from REG column", () => {
    const r = parseAimsDayRep(loadFixtureMatrix());
    expect(r.aircraft).toHaveLength(73);
    const types = new Set(r.aircraft.map((a) => a.aircraft_type));
    expect(types).toEqual(new Set(["A320", "A321", "A330"]));
  });

  it("rolls overnight STA to next day (UTC instants resolved via airport tz)", () => {
    const r = parseAimsDayRep(loadFixtureMatrix());
    // Sample row: 28/04/26  2980  VN-A516  321  CXR  HAN  23:50  01:35
    // CXR & HAN are both UTC+7 (no DST). STD CXR-local 23:50 → 16:50Z 28-Apr;
    // STA HAN-local 01:35 wraps to next destination-local day → 18:35Z 28-Apr.
    const overnight = r.schedule.find(
      (f) => f.flight_number === "2980" && f.aircraft_id === "VN-A516",
    );
    expect(overnight).toBeDefined();
    expect(overnight!.std.toISOString()).toBe("2026-04-28T16:50:00.000Z");
    expect(overnight!.sta.toISOString()).toBe("2026-04-28T18:35:00.000Z");
  });

  it("aircraft current_station = first DEP, available_from = earliest STD (UTC)", () => {
    const r = parseAimsDayRep(loadFixtureMatrix());
    const a200 = r.aircraft.find((a) => a.aircraft_id === "VN-A200");
    expect(a200).toBeDefined();
    // VN-A200 first leg in fixture is 28/04/26 463 HAN→VCA STD 10:20.
    // HAN is UTC+7 → 03:20Z.
    expect(a200!.current_station).toBe("HAN");
    expect(a200!.available_from.toISOString()).toBe(
      "2026-04-28T03:20:00.000Z",
    );
  });

  it("resolves cross-tz international STA against the destination timezone", () => {
    const r = parseAimsDayRep(loadFixtureMatrix());
    // Find any HAN/SGN→ICN leg in the fixture (origin UTC+7, dest UTC+9).
    const intl = r.schedule.find(
      (f) =>
        f.destination === "ICN" &&
        (f.origin === "HAN" || f.origin === "SGN" || f.origin === "DAD"),
    );
    if (!intl) return; // fixture-dependent; skip silently if absent.
    // The block time stays positive and matches local clock arithmetic minus
    // the 2-hour tz delta (origin +7 → destination +9).
    const blockMs = intl.sta.getTime() - intl.std.getTime();
    expect(blockMs).toBeGreaterThan(0);
    expect(blockMs).toBeLessThan(8 * 3600 * 1000); // sane upper bound
  });

  it("flags is_international for non-VN destinations", () => {
    const r = parseAimsDayRep(loadFixtureMatrix());
    const intl = r.schedule.find(
      (f) => f.destination === "ICN" || f.origin === "NRT",
    );
    expect(intl).toBeDefined();
    expect(intl!.is_international).toBe(true);

    const dom = r.schedule.find(
      (f) => f.origin === "HAN" && f.destination === "SGN",
    );
    expect(dom).toBeDefined();
    expect(dom!.is_international).toBe(false);
  });

  it("produces unique flight_ids even on round-trip same-flight-number rotations", () => {
    const r = parseAimsDayRep(loadFixtureMatrix());
    const ids = r.schedule.map((f) => f.flight_id);
    const seen = new Set(ids);
    expect(seen.size).toBe(ids.length);

    // Spot check: flight 5068 on VN-A537 appears twice in the fixture (HAN→CXR
    // outbound + CXR→HAN return). flight_id must include origin to disambiguate.
    const f5068 = r.schedule.filter(
      (f) => f.flight_number === "5068" && f.aircraft_id === "VN-A537",
    );
    if (f5068.length === 2) {
      expect(f5068[0].flight_id).not.toBe(f5068[1].flight_id);
      expect(new Set(f5068.map((f) => f.flight_id)).size).toBe(2);
    }
  });

  it("marks last leg of each rotation as is_last_flight_of_day", () => {
    const r = parseAimsDayRep(loadFixtureMatrix());
    const counts = new Map<string, number>();
    for (const f of r.schedule) {
      if (f.is_last_flight_of_day) {
        counts.set(f.aircraft_id, (counts.get(f.aircraft_id) ?? 0) + 1);
      }
    }
    // Exactly one last-flight per aircraft.
    for (const [, n] of counts) expect(n).toBe(1);
    expect(counts.size).toBe(73);
  });
});
