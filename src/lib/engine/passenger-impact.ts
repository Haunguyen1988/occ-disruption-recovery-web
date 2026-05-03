import type {
  FlightLeg,
  FlightPassengerImpact,
  OccRules,
  PassengerImpact,
  RecoveryOption,
} from "@/lib/types";

const DEFAULT_CAPACITY_BY_TYPE: Record<string, number> = {
  A320: 180,
  A321: 230,
  A330: 377,
};

function seatCapacity(flight: FlightLeg, rules: OccRules): number {
  const passengerRules = rules.passenger_rules;
  return Math.max(
    0,
    Math.round(
      flight.seat_capacity ??
        passengerRules?.default_seat_capacity_by_type?.[flight.aircraft_type] ??
        DEFAULT_CAPACITY_BY_TYPE[flight.aircraft_type] ??
        passengerRules?.fallback_seat_capacity ??
        180,
    ),
  );
}

export function estimatedPassengers(flight: FlightLeg, rules: OccRules): number {
  if (typeof flight.booked_passengers === "number") {
    return Math.max(0, Math.round(flight.booked_passengers));
  }
  return Math.max(0, Math.round(seatCapacity(flight, rules) * flight.load_factor));
}

function calculatePriorityPassengerScore(
  flight: FlightLeg,
  affectedPassengers: number,
  rules: OccRules,
): number {
  const passengerRules = rules.passenger_rules;
  let multiplier = 1;
  if (flight.is_international) {
    multiplier *= passengerRules?.international_priority_multiplier ?? 1.3;
  }
  if (flight.is_last_flight_of_day) {
    multiplier *= passengerRules?.last_flight_priority_multiplier ?? 1.4;
  }

  const vipPassengers = flight.vip_passengers ?? 0;
  const specialServicePassengers = flight.special_service_passengers ?? 0;
  return Math.round(
    affectedPassengers * Math.max(0, multiplier - 1) +
      vipPassengers * (passengerRules?.vip_priority_multiplier ?? 4) +
      specialServicePassengers *
        (passengerRules?.special_service_priority_multiplier ?? 2),
  );
}

function flightImpactReasonCodes(
  flight: FlightLeg,
  delayMinutes: number,
  misconnectRiskPassengers: number,
): string[] {
  const reasons: string[] = [];
  if (delayMinutes > 0) reasons.push(`${delayMinutes} minute passenger delay`);
  if (misconnectRiskPassengers > 0) {
    reasons.push("Delay exceeds connection-risk threshold");
  }
  if (flight.is_international) reasons.push("International flight");
  if (flight.is_last_flight_of_day) reasons.push("Last flight of day");
  if ((flight.vip_passengers ?? 0) > 0) reasons.push("VIP passengers onboard");
  if ((flight.special_service_passengers ?? 0) > 0) {
    reasons.push("Special-service passengers onboard");
  }
  return reasons;
}

export function calculatePassengerImpact(
  option: RecoveryOption,
  rules: OccRules,
  schedule?: FlightLeg[],
): PassengerImpact | null {
  if (rules.passenger_rules?.enabled === false || !schedule?.length) return null;

  const flightById = new Map(schedule.map((flight) => [flight.flight_id, flight]));
  const threshold =
    rules.passenger_rules?.misconnect_delay_threshold_minutes ?? 45;

  const flightImpacts: FlightPassengerImpact[] = [];
  for (const change of option.flight_changes) {
    const flight = flightById.get(change.flight_id);
    if (!flight) continue;
    const disrupted =
      change.delay_minutes > 0 ||
      change.original_aircraft !== change.new_aircraft;
    if (!disrupted) continue;

    const estimated = estimatedPassengers(flight, rules);
    const connectingPassengers = flight.connecting_passengers ?? estimated;
    const misconnectRisk =
      change.delay_minutes >= threshold ? Math.min(connectingPassengers, estimated) : 0;
    const passengerDelayMinutes = estimated * Math.max(0, change.delay_minutes);
    const priorityScore = calculatePriorityPassengerScore(
      flight,
      estimated,
      rules,
    );

    flightImpacts.push({
      flight_id: flight.flight_id,
      flight_number: flight.flight_number,
      estimated_passengers: estimated,
      affected_passengers: estimated,
      passenger_delay_minutes: passengerDelayMinutes,
      misconnect_risk_passengers: misconnectRisk,
      priority_passenger_score: priorityScore,
      reason_codes: flightImpactReasonCodes(
        flight,
        change.delay_minutes,
        misconnectRisk,
      ),
    });
  }

  if (flightImpacts.length === 0) {
    return {
      estimated_affected_passengers: 0,
      passenger_delay_minutes: 0,
      misconnect_risk_passengers: 0,
      priority_passenger_score: 0,
      high_impact: false,
      top_impacted_flights: [],
    };
  }

  const estimatedAffectedPassengers = flightImpacts.reduce(
    (sum, item) => sum + item.affected_passengers,
    0,
  );
  const passengerDelayMinutes = flightImpacts.reduce(
    (sum, item) => sum + item.passenger_delay_minutes,
    0,
  );
  const misconnectRiskPassengers = flightImpacts.reduce(
    (sum, item) => sum + item.misconnect_risk_passengers,
    0,
  );
  const priorityPassengerScore = flightImpacts.reduce(
    (sum, item) => sum + item.priority_passenger_score,
    0,
  );

  const topImpactedFlights = [...flightImpacts]
    .sort(
      (a, b) =>
        b.passenger_delay_minutes +
        b.priority_passenger_score * 100 -
        (a.passenger_delay_minutes + a.priority_passenger_score * 100),
    )
    .slice(0, 3);

  return {
    estimated_affected_passengers: estimatedAffectedPassengers,
    passenger_delay_minutes: passengerDelayMinutes,
    misconnect_risk_passengers: misconnectRiskPassengers,
    priority_passenger_score: priorityPassengerScore,
    high_impact:
      estimatedAffectedPassengers >=
      (rules.passenger_rules?.high_impact_passenger_threshold ?? 150),
    top_impacted_flights: topImpactedFlights,
  };
}
