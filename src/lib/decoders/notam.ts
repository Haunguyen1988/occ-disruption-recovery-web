/**
 * NOTAM Q-line + free-text minimal decoder for OCC alerting.
 *
 * A real ICAO NOTAM has:
 *   Q) FIR/QCODE/IV/NBO/AE/000/999/COORDS
 *   A) airport ICAO
 *   B) start time YYMMDDHHMM
 *   C) end time YYMMDDHHMM (or PERM)
 *   D) schedule (optional)
 *   E) free text
 *   F)/G) altitude band (optional)
 *
 * We extract A/B/C/E and infer the operational impact category from the Q-code
 * (e.g. QMRLC = runway closed, QFAHX = aerodrome closed).
 */

export interface DecodedNotam {
  raw: string;
  series_number: string | null;
  q_code: string | null;
  fir: string | null;
  airport: string | null;
  start_utc: string | null;
  end_utc: string | null;
  is_permanent: boolean;
  text: string;
  category:
    | "AERODROME_CLOSED"
    | "RUNWAY_CLOSED"
    | "TAXIWAY"
    | "NAVAID"
    | "OBSTACLE"
    | "AIRSPACE"
    | "OTHER";
}

export interface NotamAlert {
  level: "info" | "warning" | "danger";
  code: string;
  message: string;
}

const Q_CATEGORIES: Array<{ prefix: RegExp; category: DecodedNotam["category"] }> = [
  { prefix: /^QFA/, category: "AERODROME_CLOSED" },
  { prefix: /^QMR/, category: "RUNWAY_CLOSED" },
  { prefix: /^QMX/, category: "RUNWAY_CLOSED" },
  { prefix: /^QMT/, category: "TAXIWAY" },
  { prefix: /^QIC|^QIL|^QIG|^QID/, category: "NAVAID" },
  { prefix: /^QOB/, category: "OBSTACLE" },
  { prefix: /^QR/, category: "AIRSPACE" },
];

function categorize(qCode: string | null): DecodedNotam["category"] {
  if (!qCode) return "OTHER";
  for (const c of Q_CATEGORIES) {
    if (c.prefix.test(qCode)) return c.category;
  }
  return "OTHER";
}

function parseNotamTime(s: string): string | null {
  // YYMMDDHHMM
  if (!/^\d{10}$/.test(s)) return null;
  const yy = Number(s.slice(0, 2));
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  const mm = Number(s.slice(2, 4)) - 1;
  const dd = Number(s.slice(4, 6));
  const hh = Number(s.slice(6, 8));
  const mi = Number(s.slice(8, 10));
  const d = new Date(Date.UTC(year, mm, dd, hh, mi));
  return d.toISOString();
}

export function decodeNotam(raw: string): DecodedNotam {
  const out: DecodedNotam = {
    raw,
    series_number: null,
    q_code: null,
    fir: null,
    airport: null,
    start_utc: null,
    end_utc: null,
    is_permanent: false,
    text: "",
    category: "OTHER",
  };

  // First line often has series like "A1234/24"
  const seriesM = raw.match(/\b([A-Z]\d{1,4}\/\d{2})\b/);
  if (seriesM) out.series_number = seriesM[1];

  // Q) line
  const qm = raw.match(/Q\)\s*([A-Z]{4})\/(Q[A-Z]{4})\/[A-Z]+\/[A-Z]+\/[A-Z]+\/\d+\/\d+\/[^\n]+/);
  if (qm) {
    out.fir = qm[1];
    out.q_code = qm[2];
    out.category = categorize(out.q_code);
  } else {
    // Looser: pick any QXXXX
    const qx = raw.match(/\bQ([A-Z]{4})\b/);
    if (qx) {
      out.q_code = "Q" + qx[1];
      out.category = categorize(out.q_code);
    }
  }

  const a = raw.match(/A\)\s*([A-Z]{4})/);
  if (a) out.airport = a[1];
  const b = raw.match(/B\)\s*(\d{10})/);
  if (b) out.start_utc = parseNotamTime(b[1]);
  const c = raw.match(/C\)\s*(PERM|\d{10})/);
  if (c) {
    if (c[1] === "PERM") out.is_permanent = true;
    else out.end_utc = parseNotamTime(c[1]);
  }
  const e = raw.match(/E\)\s*([\s\S]+?)(?=(?:\n[A-G]\)\s)|$)/);
  if (e) out.text = e[1].trim();

  return out;
}

export function evaluateNotam(n: DecodedNotam): NotamAlert[] {
  const alerts: NotamAlert[] = [];
  switch (n.category) {
    case "AERODROME_CLOSED":
      alerts.push({
        level: "danger",
        code: "AD_CLOSED",
        message: `${n.airport ?? "Aerodrome"} closed${n.start_utc ? ` from ${n.start_utc}` : ""}${n.end_utc ? ` to ${n.end_utc}` : ""}`,
      });
      break;
    case "RUNWAY_CLOSED":
      alerts.push({
        level: "warning",
        code: "RWY_CLOSED",
        message: `Runway closed at ${n.airport ?? "?"}`,
      });
      break;
    case "TAXIWAY":
      alerts.push({
        level: "info",
        code: "TWY",
        message: `Taxiway notice at ${n.airport ?? "?"}`,
      });
      break;
    case "NAVAID":
      alerts.push({
        level: "warning",
        code: "NAVAID",
        message: `Navaid u/s at ${n.airport ?? "?"}`,
      });
      break;
    case "OBSTACLE":
      alerts.push({
        level: "info",
        code: "OBST",
        message: "New obstacle reported",
      });
      break;
    case "AIRSPACE":
      alerts.push({
        level: "warning",
        code: "AIRSPACE",
        message: "Airspace restriction active",
      });
      break;
    default:
      alerts.push({
        level: "info",
        code: "NOTAM",
        message: `NOTAM ${n.series_number ?? ""} for ${n.airport ?? "?"}`,
      });
  }
  return alerts;
}
