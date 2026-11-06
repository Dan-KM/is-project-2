// Tests the REAL model client (PREDICTION_MODE=api) against a stand-in HTTP
// server, so the switch to FastAPI is verified before FastAPI exists.
//
//   npm run test:prediction-api      (no database or internet needed)

import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { AppError } from "@/lib/errors";
import { getModelVersion, getPredictionMode, predict } from "@/lib/prediction";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name} ${detail}`); console.log(`  FAIL  ${name} ${detail}`); }
}

const body = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

async function expectKey(name: string, key: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, "(succeeded)");
  } catch (e) {
    check(name, e instanceof AppError && e.key === key, `(got ${e instanceof AppError ? e.key : e})`);
  }
}

async function main() {
  // What the stand-in should do on the next request
  let behaviour: "ok" | "bad" | "500" | "slow" = "ok";
  let lastRequest: { path?: string; method?: string; contentType?: string; json?: unknown } = {};

  const server = createServer(async (req, res) => {
    const raw = await body(req);
    lastRequest = { path: req.url, method: req.method, contentType: req.headers["content-type"], json: JSON.parse(raw || "null") };
    if (behaviour === "slow") return; // never answers → client timeout
    if (behaviour === "500") { res.writeHead(500).end("boom"); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(behaviour === "ok" ? { action: "High" } : { action: "Flood" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;

  process.env.PREDICTION_MODE = "api";
  process.env.MODEL_API_URL = `http://127.0.0.1:${port}/`; // trailing slash on purpose
  check("PREDICTION_MODE=api is picked up", getPredictionMode() === "api" && getModelVersion() !== "mock-v1");

  const payload = { Crop_Type: "Maize", Growth_Stage: "Flowering", Soil_Type: "Loamy", Soil_Moisture: 22, Rainfall_24h: 0 } as const;
  const action = await predict(payload);
  check("valid answer is returned", action === "High");
  check("POST /predict with JSON", lastRequest.method === "POST" && lastRequest.path === "/predict" && !!lastRequest.contentType?.includes("application/json"));
  check("payload sent exactly (no added keys, real 0 kept)", JSON.stringify(lastRequest.json) === JSON.stringify(payload));

  behaviour = "bad";
  await expectKey("unknown class is rejected", "prediction.apiBadResponse", () => predict(payload));
  behaviour = "500";
  await expectKey("server error → 'service not responding'", "prediction.apiUnavailable", () => predict(payload));
  behaviour = "slow";
  const started = Date.now();
  await expectKey("no answer → times out", "prediction.apiUnavailable", () => predict(payload));
  check("timeout is about 10 s, not forever", Date.now() - started < 15_000);

  server.closeAllConnections();
  server.close();
  await expectKey("service down → 'service not responding'", "prediction.apiUnavailable", () => predict(payload));
  delete process.env.MODEL_API_URL;
  await expectKey("no MODEL_API_URL → clear setup message", "prediction.notConfigured", () => predict(payload));

  process.env.PREDICTION_MODE = "mock";
  check("switching back to mock", getPredictionMode() === "mock" && getModelVersion() === "mock-v1");
}

main()
  .catch((e) => { failures.push(`crashed: ${e}`); console.error(e); })
  .finally(() => {
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) { failures.forEach((f) => console.log(`  - ${f}`)); process.exitCode = 1; }
  });
