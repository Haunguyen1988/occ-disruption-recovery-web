import { NextResponse } from "next/server";
import { getSession } from "@/lib/supabase/queries";
import { isStubModeAllowed, isSupabaseConfigured } from "@/lib/supabase/server";
import { fetchLiveWeatherSnapshot } from "@/lib/weather/service";
import {
  emptyWeatherSnapshot,
  loadLatestWeatherSnapshot,
} from "@/lib/weather/store";
import { serializeWeatherSnapshot } from "@/lib/weather/serialize";

export async function GET(request: Request) {
  if (isSupabaseConfigured()) {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (!isStubModeAllowed()) {
    return NextResponse.json({ error: "Weather unavailable" }, { status: 401 });
  }

  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "1";

  if (!refresh) {
    const cached = await loadLatestWeatherSnapshot();
    if (cached) {
      return NextResponse.json(serializeWeatherSnapshot(cached));
    }
  }

  try {
    const live = await fetchLiveWeatherSnapshot();
    return NextResponse.json(serializeWeatherSnapshot(live));
  } catch (e) {
    const fallback = emptyWeatherSnapshot();
    fallback.errors.push(e instanceof Error ? e.message : String(e));
    return NextResponse.json(serializeWeatherSnapshot(fallback), {
      status: 502,
    });
  }
}
