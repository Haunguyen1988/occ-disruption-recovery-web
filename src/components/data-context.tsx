"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  parseAircraftRows,
  parseCsvOrXlsx,
  parseDisruptionRows,
  parseScheduleRows,
  validateDataset,
  type ValidationIssue,
} from "@/lib/parsers/csv";
import { getDefaultRules, parseRulesYaml } from "@/lib/parsers/rules";
import type {
  Aircraft,
  DisruptionEvent,
  FlightLeg,
  OccRules,
} from "@/lib/types";
import type { SessionInfo } from "@/lib/supabase/queries";

interface DataState {
  schedule: FlightLeg[];
  aircraft: Aircraft[];
  disruption: DisruptionEvent | null;
  rules: OccRules;
  rulesYaml: string;
  validation: ValidationIssue[];
  parseIssues: {
    schedule: ValidationIssue[];
    aircraft: ValidationIssue[];
    disruption: ValidationIssue[];
  };
  isLoaded: boolean;
  session: SessionInfo | null;
}

interface DataActions {
  loadScheduleFile: (file: File) => Promise<void>;
  loadAircraftFile: (file: File) => Promise<void>;
  loadDisruptionFile: (file: File) => Promise<void>;
  setDisruption: (e: DisruptionEvent | null) => void;
  setRulesYaml: (yaml: string) => void;
  loadSampleData: (
    scenario:
      | "aog"
      | "airport_close"
      | "weather"
      | "late_arrival",
  ) => Promise<void>;
  reset: () => void;
}

const Ctx = createContext<(DataState & DataActions) | null>(null);

const SAMPLE_FILES = {
  schedule: "/sample_schedule.csv",
  aircraft: "/sample_aircraft.csv",
  aog: "/sample_disruption_aog.csv",
  airport_close: "/sample_disruption_airport_close.csv",
  weather: "/sample_disruption_weather.csv",
  late_arrival: "/sample_disruption_late_arrival.csv",
};

const DEFAULT_RULES_YAML = `aircraft_rules:
  allow_same_fleet_swap: true
  allow_cross_fleet_swap: false
  max_swap_chain_length: 3
  compatible_types:
    A320: [A320]
    A321: [A321]

turnaround_rules:
  default_minutes: 40
  by_aircraft_type:
    A320: 35
    A321: 40

airport_rules:
  enforce_closure_window: true
  reopen_buffer_minutes: 30
  enforce_curfew: true

maintenance_rules:
  prohibit_swap_if_next_check_risk: true
  next_check_buffer_minutes: 60

priority_rules:
  protect_last_flight_of_day: true
  protect_high_load_factor: true
  high_load_factor_threshold: 0.85
  protect_international_flight: true

spread_delay_rules:
  enabled: true
  max_delay_per_flight_minutes: 90

flat_delay_rules:
  max_normal_delay_minutes: 180
  max_deep_delay_minutes: 360

score_weights:
  total_delay_weight: 1.0
  max_delay_weight: 1.5
  impacted_flight_weight: 10
  swap_penalty: 25
  maintenance_risk_penalty: 150
  closure_violation_penalty: 200
  curfew_risk_penalty: 120
  priority_protection_bonus: 40
`;

export interface DataProviderProps {
  children: ReactNode;
  initialSession?: SessionInfo | null;
  initialSchedule?: FlightLeg[] | null;
  initialAircraft?: Aircraft[] | null;
  initialDisruption?: DisruptionEvent | null;
}

export function DataProvider({
  children,
  initialSession = null,
  initialSchedule = null,
  initialAircraft = null,
  initialDisruption = null,
}: DataProviderProps) {
  const [schedule, setSchedule] = useState<FlightLeg[]>(initialSchedule ?? []);
  const [aircraft, setAircraft] = useState<Aircraft[]>(initialAircraft ?? []);
  const [disruption, setDisruption] = useState<DisruptionEvent | null>(
    initialDisruption ?? null,
  );
  const [rulesYaml, setRulesYaml] = useState(DEFAULT_RULES_YAML);
  const [parseIssues, setParseIssues] = useState<DataState["parseIssues"]>({
    schedule: [],
    aircraft: [],
    disruption: [],
  });
  const seededFromServer = Boolean(
    initialSchedule?.length || initialAircraft?.length || initialDisruption,
  );
  const [isLoaded, setIsLoaded] = useState(seededFromServer);
  const [session] = useState<SessionInfo | null>(initialSession);

  const rules = useMemo<OccRules>(() => {
    try {
      return parseRulesYaml(rulesYaml);
    } catch {
      return getDefaultRules();
    }
  }, [rulesYaml]);

  const validation = useMemo(
    () => validateDataset({ schedule, aircraft }),
    [schedule, aircraft],
  );

  const loadScheduleFile = useCallback(async (file: File) => {
    const rows = await parseCsvOrXlsx(file);
    const { data, issues } = parseScheduleRows(rows);
    setSchedule(data);
    setParseIssues((p) => ({ ...p, schedule: issues }));
  }, []);

  const loadAircraftFile = useCallback(async (file: File) => {
    const rows = await parseCsvOrXlsx(file);
    const { data, issues } = parseAircraftRows(rows);
    setAircraft(data);
    setParseIssues((p) => ({ ...p, aircraft: issues }));
  }, []);

  const loadDisruptionFile = useCallback(async (file: File) => {
    const rows = await parseCsvOrXlsx(file);
    const { data, issues } = parseDisruptionRows(rows);
    setDisruption(data[0] ?? null);
    setParseIssues((p) => ({ ...p, disruption: issues }));
  }, []);

  const loadSampleData = useCallback(
    async (
      scenario: "aog" | "airport_close" | "weather" | "late_arrival",
    ) => {
      async function fetchRows(path: string) {
        const text = await fetch(path).then((r) => r.text());
        const blob = new Blob([text], { type: "text/csv" });
        const file = new File([blob], path.split("/").pop() ?? "sample.csv");
        return parseCsvOrXlsx(file);
      }
      const [s, a, d] = await Promise.all([
        fetchRows(SAMPLE_FILES.schedule),
        fetchRows(SAMPLE_FILES.aircraft),
        fetchRows(SAMPLE_FILES[scenario]),
      ]);
      const sched = parseScheduleRows(s);
      const ac = parseAircraftRows(a);
      const dis = parseDisruptionRows(d);
      setSchedule(sched.data);
      setAircraft(ac.data);
      setDisruption(dis.data[0] ?? null);
      setParseIssues({
        schedule: sched.issues,
        aircraft: ac.issues,
        disruption: dis.issues,
      });
      setIsLoaded(true);
    },
    [],
  );

  const reset = useCallback(() => {
    setSchedule([]);
    setAircraft([]);
    setDisruption(null);
    setParseIssues({ schedule: [], aircraft: [], disruption: [] });
    setIsLoaded(false);
  }, []);

  // Auto-load sample data on first mount only when running in stub mode
  // (no Supabase session). With a session, the layout already supplied
  // server-side data.
  useEffect(() => {
    if (isLoaded || session) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) void loadSampleData("aog");
    });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, session, loadSampleData]);

  const value = useMemo(
    () => ({
      schedule,
      aircraft,
      disruption,
      rules,
      rulesYaml,
      validation,
      parseIssues,
      isLoaded,
      session,
      loadScheduleFile,
      loadAircraftFile,
      loadDisruptionFile,
      setDisruption,
      setRulesYaml,
      loadSampleData,
      reset,
    }),
    [
      schedule,
      aircraft,
      disruption,
      rules,
      rulesYaml,
      validation,
      parseIssues,
      isLoaded,
      session,
      loadScheduleFile,
      loadAircraftFile,
      loadDisruptionFile,
      loadSampleData,
      reset,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
