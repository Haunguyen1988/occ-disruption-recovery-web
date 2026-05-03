import { NextResponse } from "next/server";
import { fetchLiveWeatherSnapshot } from "@/lib/weather/service";
import { persistWeatherSnapshot } from "@/lib/weather/store";
import { serializeWeatherSnapshot } from "@/lib/weather/serialize";

function cronAuthorized(request: Request): boolean {
  const secret = process.env.WEATHER_CRON_SECRET;
  if (!secret && process.env.NODE_ENV !== "production") return true;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await fetchLiveWeatherSnapshot();
  const storage = await persistWeatherSnapshot(snapshot);
  return NextResponse.json({
    ...serializeWeatherSnapshot(snapshot),
    storage,
  });
}
