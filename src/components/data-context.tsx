"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  detectScheduleRowDates,
  filterScheduleRowsByDate,
  parseAircraftRows,
  parseCsvOrXlsx,
  parseDisruptionRows,
  parseScheduleRows,
  validateDataset,
  type ImportDateCandidate,
  type ParsedRows,
  type ValidationIssue,
} from "@/lib/parsers/csv";
import {
  detectAimsDayRepDates,
  filterAimsDayRepByDate,
  parseAimsDayRep,
  tryReadAimsWorkbookMatrix,
} from "@/lib/parsers/aims";
import {
  DEFAULT_RULES_YAML,
  getDefaultRules,
  parseRulesYaml,
} from "@/lib/parsers/rules";
import type {
  Aircraft,
  DisruptionEvent,
  FlightLeg,
  OccRules,
} from "@/lib/types";
import type {
  OperationalLoadError,
  SessionInfo,
} from "@/lib/supabase/queries";

interface DataState {
  schedule: FlightLeg[];
  aircraft: Aircraft[];
  disruption: DisruptionEvent | null;
  rules: OccRules;
  rulesYaml: string;
  rulesError: string | null;
  validation: ValidationIssue[];
  parseIssues: {
    schedule: ValidationIssue[];
    aircraft: ValidationIssue[];
    disruption: ValidationIssue[];
  };
  detectedFormat: "aims_dayrep" | null;
  scheduleDateFilter: ScheduleDateFilterSummary | null;
  isLoaded: boolean;
  session: SessionInfo | null;
  operationalLoadError: OperationalLoadError | null;
}

interface DataActions {
  loadScheduleFile: (file: File) => Promise<void>;
  setScheduleOperatingDate: (selectedDate: string | null) => Promise<void>;
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

export interface ScheduleDateFilterSummary {
  fileName: string;
  detectedFormat: "aims_dayrep" | "schedule";
  candidates: ImportDateCandidate[];
  selectedDate: string | null;
}

type ScheduleImportSource =
  | {
      kind: "aims_dayrep";
      matrix: unknown[][];
    }
  | {
      kind: "schedule";
      rows: ParsedRows;
    };

const Ctx = createContext<(DataState & DataActions) | null>(null);

const SAMPLE_FILES = {
  schedule: "/sample_schedule.csv",
  aircraft: "/sample_aircraft.csv",
  aog: "/sample_disruption_aog.csv",
  airport_close: "/sample_disruption_airport_close.csv",
  weather: "/sample_disruption_weather.csv",
  late_arrival: "/sample_disruption_late_arrival.csv",
};

export interface DataProviderProps {
  children: ReactNode;
  initialSession?: SessionInfo | null;
  initialSchedule?: FlightLeg[] | null;
  initialAircraft?: Aircraft[] | null;
  initialDisruption?: DisruptionEvent | null;
  initialOperationalLoadError?: OperationalLoadError | null;
}

export function DataProvider({
  children,
  initialSession = null,
  initialSchedule = null,
  initialAircraft = null,
  initialDisruption = null,
  initialOperationalLoadError = null,
}: DataProviderProps) {
  const [schedule, setSchedule] = useState<FlightLeg[]>(initialSchedule ?? []);
  const [aircraft, setAircraft] = useState<Aircraft[]>(initialAircraft ?? []);
  const [disruption, setDisruption] = useState<DisruptionEvent | null>(
    initialDisruption ?? null,
  );
  const [rulesYaml, setRulesYaml] = useState(DEFAULT_RULES_YAML);
  const [rules, setRules] = useState<OccRules>(() => getDefaultRules());
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [parseIssues, setParseIssues] = useState<DataState["parseIssues"]>({
    schedule: [],
    aircraft: [],
    disruption: [],
  });
  const [detectedFormat, setDetectedFormat] = useState<
    DataState["detectedFormat"]
  >(null);
  const scheduleImportSource = useRef<ScheduleImportSource | null>(null);
  const [scheduleDateFilter, setScheduleDateFilter] =
    useState<ScheduleDateFilterSummary | null>(null);
  const seededFromServer = Boolean(
    initialSchedule?.length || initialAircraft?.length || initialDisruption,
  );
  const [isLoaded, setIsLoaded] = useState(seededFromServer);
  const [session] = useState<SessionInfo | null>(initialSession);
  const [operationalLoadError] = useState<OperationalLoadError | null>(
    initialOperationalLoadError,
  );

  const updateRulesYaml = useCallback((yaml: string) => {
    setRulesYaml(yaml);
    try {
      setRules(parseRulesYaml(yaml));
      setRulesError(null);
    } catch (e) {
      const message =
        e instanceof Error && e.message
          ? e.message
          : "Cannot parse business rules YAML";
      setRulesError(message);
    }
  }, []);

  const validation = useMemo(
    () => validateDataset({ schedule, aircraft }),
    [schedule, aircraft],
  );

  const applyAimsScheduleMatrix = useCallback((matrix: unknown[][]) => {
    const aims = parseAimsDayRep(matrix);
    setSchedule(aims.schedule);
    setAircraft(aims.aircraft);
    setDetectedFormat(aims.detectedFormat);
    setParseIssues((p) => ({
      ...p,
      schedule: aims.issues,
      aircraft: [],
    }));
    setIsLoaded(true);
  }, []);

  const applyScheduleRows = useCallback((rows: ParsedRows) => {
    const { data, issues } = parseScheduleRows(rows);
    setSchedule(data);
    setDetectedFormat(null);
    setParseIssues((p) => ({ ...p, schedule: issues }));
    setIsLoaded(true);
  }, []);

  const loadScheduleFile = useCallback(
    async (file: File) => {
      const fileName = file.name || "uploaded schedule";
      scheduleImportSource.current = null;
      setScheduleDateFilter(null);

      const aimsMatrix = await tryReadAimsWorkbookMatrix(file);
      if (aimsMatrix) {
        const candidates = detectAimsDayRepDates(aimsMatrix);
        scheduleImportSource.current = {
          kind: "aims_dayrep",
          matrix: aimsMatrix,
        };
        applyAimsScheduleMatrix(aimsMatrix);
        if (candidates.length > 1) {
          setScheduleDateFilter({
            fileName,
            detectedFormat: "aims_dayrep",
            candidates,
            selectedDate: null,
          });
        }
        return;
      }

      const rows = await parseCsvOrXlsx(file);
      const candidates = detectScheduleRowDates(rows);
      scheduleImportSource.current = {
        kind: "schedule",
        rows,
      };
      applyScheduleRows(rows);
      if (candidates.length > 1) {
        setScheduleDateFilter({
          fileName,
          detectedFormat: "schedule",
          candidates,
          selectedDate: null,
        });
      }
    },
    [applyAimsScheduleMatrix, applyScheduleRows],
  );

  const setScheduleOperatingDate = useCallback(
    async (selectedDate: string | null) => {
      const source = scheduleImportSource.current;
      if (!source) return;
      if (source.kind === "aims_dayrep") {
        applyAimsScheduleMatrix(
          selectedDate
            ? filterAimsDayRepByDate(source.matrix, selectedDate)
            : source.matrix,
        );
      } else {
        applyScheduleRows(
          selectedDate
            ? filterScheduleRowsByDate(source.rows, selectedDate)
            : source.rows,
        );
      }
      setScheduleDateFilter((current) =>
        current ? { ...current, selectedDate } : current,
      );
    },
    [applyAimsScheduleMatrix, applyScheduleRows],
  );

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
      scheduleImportSource.current = null;
      setScheduleDateFilter(null);
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
    scheduleImportSource.current = null;
    setScheduleDateFilter(null);
    setSchedule([]);
    setAircraft([]);
    setDisruption(null);
    setParseIssues({ schedule: [], aircraft: [], disruption: [] });
    setDetectedFormat(null);
    setIsLoaded(false);
  }, []);

  // No auto-load: app starts empty. User uploads data via Data Import or
  // Simulate page. The old auto-load has been removed so stale UAT data
  // does not appear on first mount.

  const value = useMemo(
    () => ({
      schedule,
      aircraft,
      disruption,
      rules,
      rulesYaml,
      rulesError,
      validation,
      parseIssues,
      detectedFormat,
      scheduleDateFilter,
      isLoaded,
      session,
      operationalLoadError,
      loadScheduleFile,
      setScheduleOperatingDate,
      loadAircraftFile,
      loadDisruptionFile,
      setDisruption,
      setRulesYaml: updateRulesYaml,
      loadSampleData,
      reset,
    }),
    [
      schedule,
      aircraft,
      disruption,
      rules,
      rulesYaml,
      rulesError,
      validation,
      parseIssues,
      detectedFormat,
      scheduleDateFilter,
      isLoaded,
      session,
      operationalLoadError,
      loadScheduleFile,
      setScheduleOperatingDate,
      loadAircraftFile,
      loadDisruptionFile,
      loadSampleData,
      reset,
      updateRulesYaml,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
