import { NextResponse } from "next/server";
import { getSession } from "@/lib/supabase/queries";
import { isStubModeAllowed, isSupabaseConfigured } from "@/lib/supabase/server";
import { fetchLiveWeatherSnapshot } from "@/lib/weather/service";
import { persistWeatherSnapshot } from "@/lib/weather/store";
import { serializeWeatherSnapshot } from "@/lib/weather/serialize";

export async function POST() {
  if (isSupabaseConfigured()) {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "controller" && session.role !== "admin") {
      return NextResponse.json({ error: "Controller role required" }, { status: 403 });
    }
  } else if (!isStubModeAllowed()) {
    return NextResponse.json({ error: "Weather refresh unavailable" }, { status: 401 });
  }

  const snapshot = await fetchLiveWeatherSnapshot();
  const storage = await persistWeatherSnapshot(snapshot);
  return NextResponse.json({
    ...serializeWeatherSnapshot(snapshot),
    storage,
  });
}
