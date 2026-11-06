// Weather integration test (needs internet for the Open-Meteo part).
//
//   npm run test:weather      (from app/system, with the Docker DB running)
//
// Covers: live fetch + normalisation, the cache, API failure → last known
// values, too-old values left out of predictions, and missing values omitted.

import { db } from "@/lib/db";
import { toRole } from "@/lib/auth/permissions";
import type { Actor } from "@/lib/auth/actor";
import * as farms from "@/lib/services/farms";
import { getFarmWeather, getWeatherFeatures, getWeatherSnapshot, saveWeatherRecord } from "@/lib/services/weather";
import { fetchOpenMeteo } from "@/lib/weather/open-meteo";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name} ${detail}`); console.log(`  FAIL  ${name} ${detail}`); }
}

let farmId: string | null = null;

async function main() {
  const seeded = await db.orm.public.Users.where({ email: "farmer@example.test" as never }).first();
  const farmer: Actor = { userId: seeded!.userId, role: toRole(seeded!.userRole) };
  const farm = await farms.createFarm(farmer, {
    farmName: `TEST weather ${Date.now()}`, farmAddress: "Mwea", latitude: -0.69, longitude: 37.35, area: 2,
  });
  farmId = farm.farmId;

  console.log("\n== Open-Meteo normalisation");
  const live = await fetchOpenMeteo(-0.69, 37.35);
  const f = live.features;
  console.log("        ", JSON.stringify(f));
  check("current temperature in a sane range", f.Ambient_Temperature !== undefined && f.Ambient_Temperature > -10 && f.Ambient_Temperature < 50);
  check("humidity 0-100", f.Relative_Humidity !== undefined && f.Relative_Humidity >= 0 && f.Relative_Humidity <= 100);
  check("wind in m/s (non-negative)", f.Wind_Speed !== undefined && f.Wind_Speed >= 0);
  check("rain past and next 24 h are sums >= 0", (f.Rainfall_24h ?? -1) >= 0 && (f.Rainfall_Forecast_24h ?? -1) >= 0);
  check("ET0 and solar radiation for today", (f.Evaporation_Demand ?? -1) >= 0 && (f.Solar_Radiation ?? -1) >= 0);
  check("soil temperature estimate present", f.Soil_Temperature !== undefined);
  check("observation time is recent", Math.abs(Date.now() - live.observedAt.getTime()) < 2 * 3_600_000);
  check("only finite numbers in the payload", Object.values(f).every((v) => typeof v === "number" && Number.isFinite(v)));

  console.log("\n== Service: live, cached, stored");
  const first = await getFarmWeather(farmer, farm.farmId, { force: true });
  check("forced refresh fetches live", first.source === "live" && !first.fetchFailed);
  const rows = await db.orm.public.WeatherData.where({ farmId: farm.farmId }).all();
  check("live values saved as one 'observed' weather_data row", rows.length === 1 && rows[0].recordType === "observed");
  // Prove the cache is used: with the network broken, the call must still succeed
  const fetchBeforeCacheTest = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("network must not be called"))) as typeof fetch;
  let second;
  try {
    second = await getFarmWeather(farmer, farm.farmId);
  } finally {
    globalThis.fetch = fetchBeforeCacheTest;
  }
  check("next call within 30 min uses the cache (no API call)", !second.fetchFailed && second.source !== "stored");
  check("a fetch from the last minute is still labelled 'just updated'", second.source === "live");
  check("cache keeps the soil temperature estimate", second.features.Soil_Temperature !== undefined);

  // Simulate the weather service being down
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("simulated network failure"))) as typeof fetch;
  try {
    const down = await getWeatherSnapshot(farm.farmId, { force: true });
    check("API down → last known values, flagged", down.source === "stored" && down.fetchFailed && down.observedAt !== null);
    check("last known values still shown", down.features.Ambient_Temperature !== undefined);
    check("still recent → still usable for prediction", down.usableForPrediction);
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log("\n== Age and missing values");
  // Pretend it is 7 h later: the cache has expired and the API is down, so only
  // the 7-hour-old stored row is left, which is too old to use for a prediction
  globalThis.fetch = (() => Promise.reject(new Error("simulated network failure"))) as typeof fetch;
  try {
    const old = await getWeatherFeatures(farm.farmId, new Date(Date.now() + 7 * 3_600_000));
    check("values older than 6 h are left out of predictions", Object.keys(old.features).length === 0 && !old.snapshot.usableForPrediction);
    check("...but still shown to the farmer as last known", old.snapshot.features.Ambient_Temperature !== undefined);
  } finally {
    globalThis.fetch = realFetch;
  }

  // A newer partial row (e.g. typed by hand): missing values stay missing
  await saveWeatherRecord({ farmId: farm.farmId, dateTime: new Date(Date.now() + 60_000).toISOString(), recordType: "observed", ambientTemperature: 25, rainfall24h: 0 });
  globalThis.fetch = (() => Promise.reject(new Error("simulated network failure"))) as typeof fetch;
  try {
    const partial = await getWeatherSnapshot(farm.farmId, { force: true });
    check("missing values are absent, not 0", partial.features.Wind_Speed === undefined && partial.missing.includes("Wind_Speed"));
    check("a real 0 mm of rain is kept", partial.features.Rainfall_24h === 0);
  } finally {
    globalThis.fetch = realFetch;
  }

  const empty = await farms.createFarm(farmer, { farmName: `TEST weather empty ${Date.now()}`, farmAddress: "-", latitude: 0, longitude: 0, area: 1 });
  globalThis.fetch = (() => Promise.reject(new Error("simulated network failure"))) as typeof fetch;
  try {
    const none = await getWeatherSnapshot(empty.farmId, { force: true });
    check("API down and nothing saved → 'none', no crash", none.source === "none" && none.fetchFailed && Object.keys(none.features).length === 0);
  } finally {
    globalThis.fetch = realFetch;
    await db.orm.public.Farm.where({ farmId: empty.farmId }).delete();
  }
}

main()
  .catch((e) => { failures.push(`crashed: ${e}`); console.error(e); })
  .finally(async () => {
    if (farmId) await db.orm.public.Farm.where({ farmId }).delete().catch(() => {});
    await db.close();
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) { failures.forEach((f) => console.log(`  - ${f}`)); process.exitCode = 1; }
  });
