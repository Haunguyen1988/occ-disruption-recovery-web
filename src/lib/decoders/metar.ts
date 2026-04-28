/**
 * Lightweight METAR / TAF decoder for OCC alerting.
 *
 * Coverage (good-enough for demo):
 *  - Station, time
 *  - Wind dir/speed/gust (KT)
 *  - Visibility (m or SM)
 *  - Weather phenomena (TS, RA, FG, SN, ...)
 *  - Cloud layers (FEW/SCT/BKN/OVC + height in 100ft)
 *  - Temperature/Dewpoint
 *  - QNH
 *  - CAVOK
 *
 * Returns a structured DecodedMetar plus a list of operational alerts based on
 * configurable thresholds (CAT I/II/III minima are airline-specific; we use
 * conservative LCC narrowbody defaults).
 */

export interface DecodedWind {
  direction_deg: number | null; // null when VRB
  variable: boolean;
  speed_kt: number;
  gust_kt: number | null;
}

export interface DecodedCloud {
  cover: "FEW" | "SCT" | "BKN" | "OVC" | "NSC" | "NCD";
  base_ft: number | null;
  cb: boolean;
}

export interface DecodedMetar {
  raw: string;
  station: string | null;
  observation_time_utc: string | null;
  wind: DecodedWind | null;
  visibility_m: number | null;
  cavok: boolean;
  weather: string[];
  clouds: DecodedCloud[];
  temperature_c: number | null;
  dewpoint_c: number | null;
  qnh_hpa: number | null;
  ceiling_ft: number | null;
}

export interface MetarAlert {
  level: "info" | "warning" | "danger";
  code: string;
  message: string;
}

const SIG_WX = [
  "TS",
  "TSRA",
  "TSGR",
  "FZRA",
  "FZFG",
  "SQ",
  "FC",
  "GR",
  "GS",
  "BLSN",
  "VA",
  "DS",
  "SS",
  "FG",
  "BR",
  "RA",
  "SN",
  "DZ",
  "PL",
  "SHRA",
  "SHSN",
  "MIFG",
  "BCFG",
];

export function decodeMetar(raw: string): DecodedMetar {
  const tokens = raw.replace(/\s+/g, " ").trim().split(" ");
  const out: DecodedMetar = {
    raw,
    station: null,
    observation_time_utc: null,
    wind: null,
    visibility_m: null,
    cavok: false,
    weather: [],
    clouds: [],
    temperature_c: null,
    dewpoint_c: null,
    qnh_hpa: null,
    ceiling_ft: null,
  };

  let i = 0;
  if (tokens[i] === "METAR" || tokens[i] === "SPECI") i += 1;

  // Station (4 letters)
  if (tokens[i] && /^[A-Z]{4}$/.test(tokens[i])) {
    out.station = tokens[i];
    i += 1;
  }

  // Time DDHHMMZ
  if (tokens[i] && /^\d{6}Z$/.test(tokens[i])) {
    out.observation_time_utc = tokens[i];
    i += 1;
  }

  // Wind
  const windRe = /^(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?(KT|MPS)$/;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "AUTO" || t === "COR") {
      i += 1;
      continue;
    }
    const m = t.match(windRe);
    if (m) {
      const dir = m[1] === "VRB" ? null : Number(m[1]);
      let speed = Number(m[2]);
      let gust = m[4] ? Number(m[4]) : null;
      if (m[5] === "MPS") {
        speed = Math.round(speed * 1.94384);
        if (gust !== null) gust = Math.round(gust * 1.94384);
      }
      out.wind = {
        direction_deg: dir,
        variable: m[1] === "VRB",
        speed_kt: speed,
        gust_kt: gust,
      };
      i += 1;
      // Variable wind range like 250V310 — skip
      if (tokens[i] && /^\d{3}V\d{3}$/.test(tokens[i])) i += 1;
      break;
    }
    break;
  }

  // CAVOK or visibility
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "CAVOK") {
      out.cavok = true;
      out.visibility_m = 10000;
      i += 1;
      break;
    }
    if (/^\d{4}$/.test(t)) {
      out.visibility_m = Number(t);
      i += 1;
      // Optional directional vis like 1500NW
      while (i < tokens.length && /^\d{4}[NSEW]{1,2}$/.test(tokens[i])) i += 1;
      break;
    }
    // SM visibility (US): 1SM, 3/4SM, P6SM
    if (/^P?\d+(\/\d+)?SM$/.test(t)) {
      const num = t.replace("P", "").replace("SM", "");
      let sm = 0;
      if (num.includes("/")) {
        const [n, d] = num.split("/").map(Number);
        sm = n / d;
      } else {
        sm = Number(num);
      }
      out.visibility_m = Math.round(sm * 1609);
      i += 1;
      break;
    }
    break;
  }

  // Weather phenomena & clouds & temp/QNH
  for (; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (!t) continue;
    if (
      /^(\+|-|VC|RE)?[A-Z]{2,6}$/.test(t) &&
      SIG_WX.some((w) => t === w || t.includes(w))
    ) {
      out.weather.push(t);
      continue;
    }
    const cloud = t.match(/^(FEW|SCT|BKN|OVC|NSC|NCD)(\d{3})?(CB|TCU)?$/);
    if (cloud) {
      out.clouds.push({
        cover: cloud[1] as DecodedCloud["cover"],
        base_ft: cloud[2] ? Number(cloud[2]) * 100 : null,
        cb: cloud[3] === "CB" || cloud[3] === "TCU",
      });
      continue;
    }
    const temp = t.match(/^(M?\d{2})\/(M?\d{2})$/);
    if (temp) {
      out.temperature_c = Number(temp[1].replace("M", "-"));
      out.dewpoint_c = Number(temp[2].replace("M", "-"));
      continue;
    }
    const q = t.match(/^Q(\d{4})$/);
    if (q) {
      out.qnh_hpa = Number(q[1]);
      continue;
    }
    const a = t.match(/^A(\d{4})$/);
    if (a) {
      // inHg in hundredths -> hPa approx
      out.qnh_hpa = Math.round((Number(a[1]) / 100) * 33.8639);
      continue;
    }
  }

  // Ceiling = lowest BKN/OVC base
  const ceilLayers = out.clouds.filter(
    (c) => (c.cover === "BKN" || c.cover === "OVC") && c.base_ft !== null,
  );
  if (ceilLayers.length) {
    out.ceiling_ft = Math.min(...ceilLayers.map((c) => c.base_ft as number));
  }

  return out;
}

export interface MetarThresholds {
  min_visibility_m: number;
  min_ceiling_ft: number;
  max_wind_kt: number;
  max_gust_kt: number;
  max_crosswind_kt: number;
}

export const DEFAULT_THRESHOLDS: MetarThresholds = {
  min_visibility_m: 800,
  min_ceiling_ft: 200,
  max_wind_kt: 35,
  max_gust_kt: 45,
  max_crosswind_kt: 25,
};

export function evaluateMetar(
  m: DecodedMetar,
  th: MetarThresholds = DEFAULT_THRESHOLDS,
): MetarAlert[] {
  const alerts: MetarAlert[] = [];
  if (m.cavok)
    alerts.push({ level: "info", code: "CAVOK", message: "CAVOK conditions" });

  if (m.visibility_m !== null && m.visibility_m < th.min_visibility_m) {
    alerts.push({
      level: "danger",
      code: "LOW_VIS",
      message: `Visibility ${m.visibility_m}m below minima ${th.min_visibility_m}m`,
    });
  }
  if (m.ceiling_ft !== null && m.ceiling_ft < th.min_ceiling_ft) {
    alerts.push({
      level: "danger",
      code: "LOW_CEIL",
      message: `Ceiling ${m.ceiling_ft}ft below minima ${th.min_ceiling_ft}ft`,
    });
  }
  if (m.wind) {
    if (m.wind.speed_kt > th.max_wind_kt) {
      alerts.push({
        level: "warning",
        code: "STRONG_WIND",
        message: `Wind ${m.wind.speed_kt}kt exceeds limit ${th.max_wind_kt}kt`,
      });
    }
    if (m.wind.gust_kt !== null && m.wind.gust_kt > th.max_gust_kt) {
      alerts.push({
        level: "danger",
        code: "STRONG_GUST",
        message: `Gust ${m.wind.gust_kt}kt exceeds limit ${th.max_gust_kt}kt`,
      });
    }
  }
  if (m.weather.some((w) => w.includes("TS"))) {
    alerts.push({
      level: "warning",
      code: "TS",
      message: "Thunderstorm reported",
    });
  }
  if (m.weather.some((w) => w.includes("FG"))) {
    alerts.push({ level: "warning", code: "FG", message: "Fog reported" });
  }
  if (m.clouds.some((c) => c.cb)) {
    alerts.push({
      level: "warning",
      code: "CB",
      message: "Cumulonimbus / TCU clouds reported",
    });
  }
  return alerts;
}
