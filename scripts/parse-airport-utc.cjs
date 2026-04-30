#!/usr/bin/env node
/**
 * Parse AirportUTCReport.csv → JSON + TypeScript maps.
 *
 * The CSV uses multiline quoted fields, so we can't rely on simple
 * line-by-line splitting. We use a tiny state machine to handle
 * RFC 4180 quoting rules.
 *
 * Usage:  node scripts/parse-airport-utc.cjs
 * Output: data/airports.json
 *         data/airport-timezones.ts   (copy-paste into time-utils.ts)
 */

const fs = require("fs");
const path = require("path");

const CSV_PATH = path.join(__dirname, "..", "data", "AirportUTCReport.csv");
const JSON_OUT = path.join(__dirname, "..", "data", "airports.json");
const TS_OUT = path.join(__dirname, "..", "data", "airport-timezones.ts");

// ── RFC 4180 CSV parser (handles multiline quoted fields) ──────────
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuote) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuote = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
        if (ch === "\r") i++; // skip \n after \r
        row.push(cell);
        cell = "";
        rows.push(row);
        row = [];
      } else if (ch === "\r") {
        // standalone \r inside unquoted → treat as newline
        row.push(cell);
        cell = "";
        rows.push(row);
        row = [];
      } else {
        cell += ch;
      }
    }
  }
  // flush last
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ── UTC offset parser ──────────────────────────────────────────────
// Input examples:
//   "(1) \r\n+07:00 ,DST not applied"
//   "(1) \r\n+02:00 ,DST +03:00 3/29/2026-10/25/2026"
//   "(4) \r\n-08:00 ,DST -07:00 3/8/2026-11/1/2026"
function parseTzField(raw) {
  if (!raw) return null;
  const clean = raw.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();

  // Extract standard offset
  const stdMatch = clean.match(/([+-]\d{2}:\d{2})\s*,/);
  if (!stdMatch) return null;
  const stdOffset = stdMatch[1]; // e.g. "+07:00"
  const stdHours = parseOffsetToHours(stdOffset);

  // Extract DST offset
  let dstHours = null;
  let dstStart = null;
  let dstEnd = null;
  const dstMatch = clean.match(/DST\s+([+-]\d{2}:\d{2})\s+(\d{1,2}\/\d{1,2}\/\d{4})-(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (dstMatch) {
    dstHours = parseOffsetToHours(dstMatch[1]);
    dstStart = dstMatch[2];
    dstEnd = dstMatch[3];
  }

  return { stdOffset, stdHours, dstHours, dstStart, dstEnd };
}

function parseOffsetToHours(offset) {
  const m = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (parseInt(m[2], 10) + parseInt(m[3], 10) / 60);
}

// ── Map UTC offset → IANA timezone (best-effort) ──────────────────
const OFFSET_TO_IANA = {
  "-12": "Etc/GMT+12",
  "-11": "Pacific/Pago_Pago",
  "-10": "Pacific/Honolulu",
  "-9": "America/Anchorage",
  "-8": "America/Los_Angeles",
  "-7": "America/Denver",
  "-6": "America/Chicago",
  "-5": "America/New_York",
  "-4": "America/Halifax",
  "-3": "America/Sao_Paulo",
  "-2": "Etc/GMT+2",
  "-1": "Atlantic/Azores",
  "0": "Europe/London",
  "1": "Europe/Paris",
  "2": "Europe/Istanbul",
  "3": "Europe/Moscow",
  "3.5": "Asia/Tehran",
  "4": "Asia/Dubai",
  "4.5": "Asia/Kabul",
  "5": "Asia/Karachi",
  "5.5": "Asia/Kolkata",
  "5.75": "Asia/Kathmandu",
  "6": "Asia/Dhaka",
  "6.5": "Asia/Yangon",
  "7": "Asia/Bangkok",
  "8": "Asia/Shanghai",
  "9": "Asia/Tokyo",
  "9.5": "Australia/Darwin",
  "10": "Australia/Brisbane",
  "11": "Pacific/Noumea",
  "12": "Pacific/Auckland",
  "13": "Pacific/Apia",
};

// Country-specific IANA overrides (more accurate than offset alone)
const COUNTRY_IANA = {
  "VIETNAM": "Asia/Ho_Chi_Minh",
  "THAILAND": "Asia/Bangkok",
  "INDONESIA": { "7": "Asia/Jakarta", "8": "Asia/Makassar", "9": "Asia/Jayapura" },
  "JAPAN": "Asia/Tokyo",
  "KOREA S.(REP. OF)": "Asia/Seoul",
  "CHINA": "Asia/Shanghai",
  "HONG KONG": "Asia/Hong_Kong",
  "MACAU": "Asia/Macau",
  "TAIWAN": "Asia/Taipei",
  "SINGAPORE": "Asia/Singapore",
  "MALAYSIA": "Asia/Kuala_Lumpur",
  "PHILIPPINES": "Asia/Manila",
  "INDIA": "Asia/Kolkata",
  "SRI LANKA": "Asia/Colombo",
  "BANGLADESH": "Asia/Dhaka",
  "CAMBODIA": "Asia/Phnom_Penh",
  "LAOS": "Asia/Vientiane",
  "BRUNEI DARUSSALAM": "Asia/Brunei",
  "MONGOLIA": "Asia/Ulaanbaatar",
  "MYANMAR": "Asia/Yangon",
  "NEPAL": "Asia/Kathmandu",
  "AUSTRALIA": { "9.5": "Australia/Darwin", "10": "Australia/Brisbane", "10_DST": "Australia/Sydney" },
  "NEW ZEALAND": "Pacific/Auckland",
  "UNITED STATES": { "-5": "America/New_York", "-6": "America/Chicago", "-7": "America/Denver", "-8": "America/Los_Angeles", "-9": "America/Anchorage", "-10": "Pacific/Honolulu" },
  "UNITED KINGDOM": "Europe/London",
  "FRANCE": "Europe/Paris",
  "GERMANY": "Europe/Berlin",
  "ITALY": "Europe/Rome",
  "NETHERLANDS": "Europe/Amsterdam",
  "SPAIN": "Europe/Madrid",
  "GREECE": "Europe/Athens",
  "TURKEY": "Europe/Istanbul",
  "POLAND": "Europe/Warsaw",
  "LITHUANIA": "Europe/Vilnius",
  "RUSSIAN FEDERATION": { "3": "Europe/Moscow", "4": "Europe/Samara", "5": "Asia/Yekaterinburg", "7": "Asia/Krasnoyarsk", "8": "Asia/Irkutsk", "9": "Asia/Yakutsk", "10": "Asia/Vladivostok", "11": "Asia/Magadan", "12": "Asia/Kamchatka" },
  "UNITED ARAB EMIRATES": "Asia/Dubai",
  "QATAR": "Asia/Qatar",
  "KAZAKHSTAN": { "5": "Asia/Almaty", "6": "Asia/Almaty" },
  "KYRGYZSTAN": "Asia/Bishkek",
  "TURKMENISTAN": "Asia/Ashgabat",
  "AZERBAIJAN": "Asia/Baku",
};

function resolveIANA(country, stdHours, hasDST) {
  const mapping = COUNTRY_IANA[country];
  if (!mapping) {
    return OFFSET_TO_IANA[String(stdHours)] || "Etc/UTC";
  }
  if (typeof mapping === "string") return mapping;
  // Object → lookup by offset
  if (country === "AUSTRALIA" && hasDST) {
    return mapping["10_DST"] || mapping[String(stdHours)] || "Australia/Sydney";
  }
  return mapping[String(stdHours)] || OFFSET_TO_IANA[String(stdHours)] || "Etc/UTC";
}

// ── Main ───────────────────────────────────────────────────────────
const raw = fs.readFileSync(CSV_PATH, "utf-8");
const rows = parseCSV(raw);

// Skip header rows (first 2 rows are title + column headers)
const dataRows = rows.slice(2);

const airports = [];
const seen = new Set();

for (const cols of dataRows) {
  if (cols.length < 7) continue;

  const iata = (cols[2] || "").trim();
  const icao = (cols[3] || "").trim();
  const airportName = (cols[4] || "").replace(/\r?\n/g, " ").trim();
  const countryName = (cols[1] || "").trim();
  const countryCode = (cols[0] || "").trim();
  const tzRaw = cols[6] || "";

  // Skip if no valid IATA
  if (!iata || iata.length < 2 || iata.length > 4) continue;
  if (seen.has(iata)) continue;
  seen.add(iata);

  const tz = parseTzField(tzRaw);
  if (!tz) continue;

  const hasDST = tz.dstHours !== null;
  const ianaTimezone = resolveIANA(countryName, tz.stdHours, hasDST);

  airports.push({
    iata,
    icao: icao || null,
    airport_name: airportName,
    country_code: countryCode,
    country_name: countryName,
    utc_offset_hours: tz.stdHours,
    utc_offset_str: tz.stdOffset,
    dst_offset_hours: tz.dstHours,
    dst_start: tz.dstStart || null,
    dst_end: tz.dstEnd || null,
    iana_timezone: ianaTimezone,
  });
}

// Sort by IATA
airports.sort((a, b) => a.iata.localeCompare(b.iata));

console.log(`✅ Parsed ${airports.length} airports from CSV`);

// ── Write JSON ─────────────────────────────────────────────────────
fs.writeFileSync(JSON_OUT, JSON.stringify(airports, null, 2), "utf-8");
console.log(`📄 Written: ${JSON_OUT}`);

// ── Write TypeScript maps ──────────────────────────────────────────
const tzLines = airports.map(
  (a) => `  ${a.iata}: "${a.iana_timezone}",`
);
const offsetLines = airports.map(
  (a) => `  ${a.iata}: ${a.utc_offset_hours},`
);

const tsContent = `// Auto-generated from AirportUTCReport.csv — ${airports.length} airports
// Run: node scripts/parse-airport-utc.cjs

/** IANA timezone for each IATA airport code. */
export const AIRPORT_TIMEZONES: Record<string, string> = {
${tzLines.join("\n")}
};

/** Standard UTC offset (hours, no DST) for each IATA airport code. */
export const AIRPORT_UTC_OFFSETS: Record<string, number> = {
${offsetLines.join("\n")}
};
`;

fs.writeFileSync(TS_OUT, tsContent, "utf-8");
console.log(`📄 Written: ${TS_OUT}`);

// ── Write SQL seed ─────────────────────────────────────────────────
const SQL_OUT = path.join(__dirname, "..", "supabase", "migrations", "0004_airports.sql");
const sqlInserts = airports.map((a) => {
  const esc = (v) => v ? `'${v.replace(/'/g, "''")}'` : "NULL";
  return `  (${esc(a.iata)}, ${esc(a.icao)}, ${esc(a.airport_name)}, ${esc(a.country_code)}, ${esc(a.country_name)}, ${a.utc_offset_hours}, ${esc(a.utc_offset_str)}, ${a.dst_offset_hours ?? "NULL"}, ${esc(a.dst_start)}, ${esc(a.dst_end)}, ${esc(a.iana_timezone)})`;
});

const sqlContent = `-- Auto-generated airport timezone data from AirportUTCReport.csv
-- ${airports.length} airports

CREATE TABLE IF NOT EXISTS public.airports (
  id bigserial PRIMARY KEY,
  iata text NOT NULL UNIQUE,
  icao text,
  airport_name text NOT NULL,
  country_code text,
  country_name text,
  utc_offset_hours numeric(4,2) NOT NULL,
  utc_offset_str text NOT NULL,
  dst_offset_hours numeric(4,2),
  dst_start text,
  dst_end text,
  iana_timezone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS airports_iata_idx ON public.airports(iata);

-- RLS
ALTER TABLE public.airports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS airports_select ON public.airports;
CREATE POLICY airports_select ON public.airports FOR SELECT TO authenticated USING (true);

-- Seed data
INSERT INTO public.airports (iata, icao, airport_name, country_code, country_name, utc_offset_hours, utc_offset_str, dst_offset_hours, dst_start, dst_end, iana_timezone)
VALUES
${sqlInserts.join(",\n")}
ON CONFLICT (iata) DO UPDATE SET
  icao = EXCLUDED.icao,
  airport_name = EXCLUDED.airport_name,
  utc_offset_hours = EXCLUDED.utc_offset_hours,
  utc_offset_str = EXCLUDED.utc_offset_str,
  dst_offset_hours = EXCLUDED.dst_offset_hours,
  dst_start = EXCLUDED.dst_start,
  dst_end = EXCLUDED.dst_end,
  iana_timezone = EXCLUDED.iana_timezone;
`;

fs.writeFileSync(SQL_OUT, sqlContent, "utf-8");
console.log(`📄 Written: ${SQL_OUT}`);

// Summary stats
const countries = new Set(airports.map((a) => a.country_name));
const dstCount = airports.filter((a) => a.dst_offset_hours !== null).length;
console.log(`\n📊 Summary:`);
console.log(`   ${airports.length} airports, ${countries.size} countries`);
console.log(`   ${dstCount} with DST, ${airports.length - dstCount} without DST`);
console.log(`   Offsets range: UTC${airports[0]?.utc_offset_str} to UTC${airports[airports.length - 1]?.utc_offset_str}`);
