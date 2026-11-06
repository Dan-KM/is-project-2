// Integration test for the data access layer against the real database.
//
//   npm run test:db        (from app/system, with the Docker DB running)
//
// It creates throwaway farms under the seeded test farmer, runs every
// transactional water operation (success AND failure paths), the CRUD
// services, ownership/permission checks and the prediction pipeline, then
// deletes everything it created. It does NOT wrap the run in a rolled-back
// transaction on purpose: the integrity checks (IR004/IR005) are DEFERRED to
// COMMIT, so they only fire on real commits.

import { db } from "@/lib/db";
import { AppError, toAppError } from "@/lib/errors";
import { t } from "@/lib/i18n";
import type { Actor } from "@/lib/auth/actor";
import { toRole } from "@/lib/auth/permissions";
import { FEATURE_NAMES } from "@/lib/features/catalog";
import { buildFeaturePayload } from "@/lib/features/payload";
import { mockPredict } from "@/lib/prediction";
import * as farms from "@/lib/services/farms";
import * as fields from "@/lib/services/fields";
import * as crops from "@/lib/services/crops";
import * as plantings from "@/lib/services/plantings";
import * as readings from "@/lib/services/readings";
import * as water from "@/lib/services/water";
import * as weather from "@/lib/services/weather";
import * as predictions from "@/lib/services/predictions";
import * as users from "@/lib/services/users";
import { predictionInputSchema, refillSchema } from "@/lib/validation/schemas";

// ---------------------------------------------------------------- harness
let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name} ${detail}`);
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

async function expectError(name: string, key: string, fn: () => PromiseLike<unknown>) {
  try {
    await fn();
    check(name, false, `(expected "${key}", but it succeeded)`);
  } catch (e) {
    const err = toAppError(e);
    check(name, err.key === key, `(expected "${key}", got "${err.key}")`);
    if (err.key === key) console.log(`        farmer sees: "${t(err.key, err.params)}"`);
  }
}

function section(title: string) {
  console.log(`\n== ${title}`);
}

const budgetOf = async (fieldId: string) =>
  Number((await db.orm.public.Field.select("remainingBudgetLitres").where({ fieldId }).first())?.remainingBudgetLitres ?? NaN);
const isNullBudget = async (fieldId: string) =>
  (await db.orm.public.Field.select("remainingBudgetLitres").where({ fieldId }).first())?.remainingBudgetLitres === null;

// ---------------------------------------------------------------- run
const createdFarms: string[] = [];
let tempUserId: string | null = null;

async function main() {
  const seeded = await db.orm.public.Users.where({ email: "farmer@example.test" as never }).first();
  if (!seeded) throw new Error("Seeded farmer@example.test not found; run the DB seed first");
  const farmer: Actor = { userId: seeded.userId, role: toRole(seeded.userRole) };
  const tag = `TEST ${Date.now()}`;

  section("Auth");
  const login = await users.verifyCredentials({ email: "farmer@example.test", password: "Farmer#2026" });
  check("seeded farmer logs in (bcrypt checked in Postgres)", login.userId === farmer.userId);
  await expectError("wrong password is rejected", "auth.invalidCredentials", () =>
    users.verifyCredentials({ email: "farmer@example.test", password: "nope-nope" }));
  const other = await users.registerFarmer({
    firstName: "Temp", lastName: "Farmer", email: `temp-${Date.now()}@example.test`, password: "Temp#12345",
  });
  tempUserId = other.userId;
  check("sign-up creates a farmer", other.role === "farmer");
  await expectError("duplicate email (case-insensitive) is rejected", "auth.emailTaken", () =>
    users.registerFarmer({ firstName: "A", lastName: "B", email: "FARMER@example.test", password: "Temp#12345" }));
  await expectError("farmer can't list users (admin only)", "errors.forbidden", () => users.listUsers(farmer));

  section("Farm and field CRUD + area triggers");
  const farm = await farms.createFarm(farmer, {
    farmName: `${tag} farm`, farmAddress: "Nyeri", latitude: -0.42, longitude: 36.95, area: 10,
  });
  createdFarms.push(farm.farmId);
  check("farm created", !!farm.farmId);
  const fieldA = await fields.createField(farmer, { farmId: farm.farmId, fieldName: "A", soilType: "Loamy", area: 4, fieldSlope: 2 });
  const fieldB = await fields.createField(farmer, { farmId: farm.farmId, fieldName: "B", soilType: "Clay", area: 4 });
  check("two fields created", !!fieldA.fieldId && !!fieldB.fieldId);
  await expectError("fields can't exceed the farm's area", "field.areaExceedsFarm", () =>
    fields.createField(farmer, { farmId: farm.farmId, fieldName: "C", soilType: "Sandy", area: 3 }));
  await expectError("field names are unique per farm", "field.nameTaken", () =>
    fields.createField(farmer, { farmId: farm.farmId, fieldName: "A", soilType: "Sandy", area: 1 }));
  await expectError("farm can't shrink below its fields", "farm.cannotShrink", () =>
    farms.updateFarm(farmer, { farmId: farm.farmId, farmName: `${tag} farm`, farmAddress: "Nyeri", latitude: -0.42, longitude: 36.95, area: 5 }));
  await expectError("another farmer can't see this farm", "errors.notFound", () =>
    farms.getFarm({ userId: other.userId, role: "farmer" }, farm.farmId));

  section("Plantings (replace_field_crop) and growth records");
  const cropList = await crops.listCrops(farmer);
  check("crop catalog = the 8 dataset crops", cropList.length === 8);
  const maize = cropList.find((c) => c.cropName === "Maize")!;
  const tomato = cropList.find((c) => c.cropName === "Tomato")!;
  const first = await plantings.plantCrop(farmer, { fieldId: fieldA.fieldId, cropId: tomato.cropId, plantingDate: "2026-09-01" });
  const plantA = await plantings.plantCrop(farmer, { fieldId: fieldA.fieldId, cropId: maize.cropId, plantingDate: "2026-09-15" });
  const all = await plantings.listPlantings(farmer, fieldA.fieldId);
  check("replanting ends the old planting", all.filter((p) => p.isActive).length === 1 &&
    all.find((p) => p.fieldCropId === first.fieldCropId)?.isActive === false);
  const plantB = await plantings.plantCrop(farmer, { fieldId: fieldB.fieldId, cropId: tomato.cropId, plantingDate: "2026-09-20" });
  const growth = await plantings.createGrowthRecord(farmer, {
    fieldCropId: plantA.fieldCropId, recordedAt: new Date().toISOString(), growthStage: "Vegetative", rootZoneDepth: 0.4,
  });
  check("growth record derives days since planting", (growth.daysSincePlanting ?? -1) > 0);

  section("Water: ledger before any water");
  await expectError("irrigating with no water recorded", "water.noInitialEntry", () =>
    water.recordIrrigation(farmer, { fieldCropId: plantA.fieldCropId, quantityLitres: 10 }));
  await expectError("refill before the first entry", "water.noInitialEntry", () =>
    water.recordRefill(farmer, { farmId: farm.farmId, quantityLitres: 10 }));

  section("Water: initial entry and allocations");
  const init = await water.recordInitialEntry(farmer, { farmId: farm.farmId, quantityLitres: 1000, notes: "tank filled" });
  check("initial entry sets balance 1000 L", init.balanceLitres === 1000);
  await expectError("second initial entry is refused", "water.alreadyInitial", () =>
    water.recordInitialEntry(farmer, { farmId: farm.farmId, quantityLitres: 5 }));
  await expectError("irrigating a field with no allocation (IR003)", "water.noAllocation", () =>
    water.recordIrrigation(farmer, { fieldCropId: plantA.fieldCropId, quantityLitres: 10 }));
  const noAlloc = await water.checkIrrigation(farmer, { fieldCropId: plantA.fieldCropId, quantityLitres: 10 });
  check("pre-check reports NO_ALLOCATION", noAlloc.reasonCode === "NO_ALLOCATION" && !noAlloc.allowed);

  const allocA = await water.setAllocation(farmer, { fieldId: fieldA.fieldId, percentage: 50 });
  check("A at 50% of 1000 L unallocated → budget 500", allocA.remainingBudgetLitres === 500);
  await expectError("allocations over 100% are refused", "water.allocationOver100", () =>
    water.setAllocation(farmer, { fieldId: fieldB.fieldId, percentage: 60 }));
  const allocB = await water.setAllocation(farmer, { fieldId: fieldB.fieldId, percentage: 30 });
  check("B at 30% of the 500 L left → budget 150", allocB.remainingBudgetLitres === 150);
  const status1 = await farms.getFarmWaterStatus(farmer, farm.farmId);
  check("farm status: 1000 balance / 650 allocated / 350 unallocated",
    status1.balanceLitres === 1000 && status1.allocatedLitres === 650 && status1.unallocatedLitres === 350,
    JSON.stringify(status1));

  section("Water: irrigation limits and replenishment");
  await expectError("more than the field budget (IR002)", "water.exceedsFieldBudget", () =>
    water.recordIrrigation(farmer, { fieldCropId: plantA.fieldCropId, quantityLitres: 600 }));
  const tooMuch = await water.checkIrrigation(farmer, { fieldCropId: plantA.fieldCropId, quantityLitres: 600 });
  check("pre-check: EXCEEDS_FIELD_BUDGET, max 500", tooMuch.reasonCode === "EXCEEDS_FIELD_BUDGET" && tooMuch.maxLitres === 500);
  const irr1 = await water.recordIrrigation(farmer, { fieldCropId: plantA.fieldCropId, quantityLitres: 200 });
  check("irrigate 200 L → OK, budget 300, balance 800",
    irr1.statusCode === "OK" && irr1.fieldBudgetLitres === 300 && irr1.farmBalanceLitres === 800, JSON.stringify(irr1));
  const irr2 = await water.recordIrrigation(farmer, { fieldCropId: plantA.fieldCropId, quantityLitres: 300 });
  // balance 500, budgets A 0 + B 150 → unallocated 350 → A gets TRUNC(50% × 350) = 175
  check("budget hits 0 → replenished with 175 L", irr2.statusCode === "BUDGET_REPLENISHED" && irr2.fieldBudgetLitres === 175,
    JSON.stringify(irr2));

  await water.setAllocation(farmer, { fieldId: fieldB.fieldId });
  check("removing B's allocation releases its budget (NULL)", await isNullBudget(fieldB.fieldId));
  await water.setAllocation(farmer, { fieldId: fieldA.fieldId, percentage: 100 });
  check("changing A's % keeps its current budget (175)", (await budgetOf(fieldA.fieldId)) === 175);
  const irr3 = await water.recordIrrigation(farmer, { fieldCropId: plantA.fieldCropId, quantityLitres: 175 });
  check("A at 100% takes all unallocated water when it hits 0 (325 L)",
    irr3.statusCode === "BUDGET_REPLENISHED" && irr3.fieldBudgetLitres === 325, JSON.stringify(irr3));
  const irr4 = await water.recordIrrigation(farmer, { fieldCropId: plantA.fieldCropId, quantityLitres: 325 });
  check("using the last water → BUDGET_EXHAUSTED, balance 0",
    irr4.statusCode === "BUDGET_EXHAUSTED" && irr4.farmBalanceLitres === 0 && irr4.fieldBudgetLitres === 0, JSON.stringify(irr4));
  await expectError("irrigating an exhausted budget", "water.budgetExhausted", () =>
    water.recordIrrigation(farmer, { fieldCropId: plantA.fieldCropId, quantityLitres: 1 }));

  section("Water: the DB guards against bypassing the functions");
  // Raw ledger insert that would take the balance below zero (balance is 0 now)
  await expectError("balance can never go negative (IR001)", "water.insufficientFarm", () =>
    db.runtime().query(db.raw.sql`
      INSERT INTO water_transaction (farm_id, transaction_type, quantity_litres)
      VALUES (${farm.farmId}::uuid, 'IRRIGATION', 50) RETURNING transaction_id`
      .returnsRow({ transaction_id: "pg/uuid@1" }).build()));

  section("Water: refill replenishes waiting fields; undo reverses it");
  const refill = await water.recordRefill(farmer, { farmId: farm.farmId, quantityLitres: 400, notes: "rain tank" });
  check("refill raises balance to 400", refill.balanceLitres === 400);
  check("exhausted field A is replenished by the refill (400 L)", (await budgetOf(fieldA.fieldId)) === 400);
  await expectError("raw IRRIGATION not charged to a budget is refused at commit (IR004/IR005)", "errors.integrity", () =>
    db.runtime().query(db.raw.sql`
      INSERT INTO water_transaction (farm_id, transaction_type, quantity_litres)
      VALUES (${farm.farmId}::uuid, 'IRRIGATION', 1) RETURNING transaction_id`
      .returnsRow({ transaction_id: "pg/uuid@1" }).build()));
  const ledger = await water.listLedger(farmer, farm.farmId);
  const edited = await water.editLedgerEntry(farmer, { transactionId: ledger[0].transactionId, notes: "edited note" });
  check("ledger notes can be edited", edited?.notes === "edited note");
  await expectError("ledger amounts are immutable", "water.immutable", () =>
    db.runtime().query(db.raw.sql`
      UPDATE water_transaction SET quantity_litres = 1 WHERE transaction_id = ${ledger[0].transactionId}::uuid
      RETURNING transaction_id`.returnsRow({ transaction_id: "pg/uuid@1" }).build()));
  const older = ledger.find((r) => r.transactionType === "INITIAL_ENTRY")!;
  await expectError("only the latest entry can be undone", "water.undoOnlyLatest", () =>
    db.orm.public.WaterTransaction.where({ transactionId: older.transactionId }).delete());
  const undo = await water.undoLatestEntry(farmer, farm.farmId);
  check("undo the refill", undo.undone.transactionType === "REFILL");
  check("undo reverses the refill's budget grant (A back to 0)", (await budgetOf(fieldA.fieldId)) === 0);
  check("balance back to 0 after undo", (await farms.getFarmWaterStatus(farmer, farm.farmId)).balanceLitres === 0);
  const history = await water.listBudgetHistory(farmer, fieldA.fieldId);
  check("budget audit trail recorded (ALLOCATE + IRRIGATE rows)",
    history.some((h) => h.reason === "ALLOCATE") && history.some((h) => h.reason === "IRRIGATE"));
  const events = await water.listIrrigationEvents(farmer, fieldA.fieldId);
  check("4 irrigation events recorded on A", events.length === 4, `(got ${events.length})`);

  section("Undo blocked when the water is allocated (IR004)");
  const farm2 = await farms.createFarm(farmer, { farmName: `${tag} farm 2`, farmAddress: "Embu", latitude: -0.5, longitude: 37.4, area: 2 });
  createdFarms.push(farm2.farmId);
  const field2 = await fields.createField(farmer, { farmId: farm2.farmId, fieldName: "Only", soilType: "Silty", area: 1 });
  await water.recordInitialEntry(farmer, { farmId: farm2.farmId, quantityLitres: 100 });
  await water.setAllocation(farmer, { fieldId: field2.fieldId, percentage: 50 });
  await expectError("undoing the initial entry while 50 L is allocated", "water.undoAllocated", () =>
    water.undoLatestEntry(farmer, farm2.farmId));

  section("Plantings: ended plantings can't irrigate; field delete");
  await water.recordRefill(farmer, { farmId: farm.farmId, quantityLitres: 300 });
  await water.setAllocation(farmer, { fieldId: fieldB.fieldId, percentage: 0 });
  await plantings.updatePlanting(farmer, { fieldCropId: plantB.fieldCropId, isActive: false });
  await expectError("ended planting can't be irrigated", "planting.inactive", () =>
    water.recordIrrigation(farmer, { fieldCropId: plantB.fieldCropId, quantityLitres: 1 }));
  await fields.deleteField(farmer, fieldB.fieldId);
  check("field B deleted (and replenish ran in the same transaction)",
    !(await db.orm.public.Field.where({ fieldId: fieldB.fieldId }).first()));

  section("Readings: derived defaults");
  await readings.createReading(farmer, { fieldId: fieldA.fieldId, dateTime: new Date(Date.now() - 86_400_000).toISOString(), soilMoisture: 40, soilPh: 6.5 });
  await readings.createReading(farmer, { fieldId: fieldA.fieldId, dateTime: new Date(Date.now() - 2 * 86_400_000).toISOString(), soilMoisture: 30 });
  const defaults = await readings.getReadingDefaults(farmer, fieldA.fieldId);
  check("defaults: last irrigation 325 L, today = 0 days, pH 6.5",
    defaults.previousIrrigationAmount === 325 && defaults.daysSinceLastIrrigation === 0 && defaults.soilPh === 6.5,
    JSON.stringify(defaults));
  const snap = (await readings.listReadings(farmer, fieldA.fieldId))[0];
  check("reading snapshots the field budget automatically", snap.waterAvailability !== null);

  section("Weather store");
  await weather.saveWeatherRecord({
    farmId: farm.farmId, dateTime: new Date().toISOString(), recordType: "observed",
    ambientTemperature: 28, relativeHumidity: 55, windSpeed: 3, rainfall24h: 0, rainfallForecast24h: 2,
    evapotranspirationRate: 5.5,
  });
  const wx = await weather.getWeatherFeatures(farm.farmId);
  check("weather stored and read back as model features", wx.features.Ambient_Temperature === 28 && wx.features.Rainfall_24h === 0);
  check("missing weather values are absent, not 0", !("Solar_Radiation" in wx.features));

  section("Prediction: payload, mock, storage");
  const assembled = await buildFeaturePayload(fieldA.fieldId, { Soil_Moisture: 22 });
  const values = Object.values(assembled.payload);
  check("payload has no null / undefined / '' values", values.every((v: unknown) => v !== null && v !== undefined && v !== ""));
  check("real zero kept (Rainfall_24h = 0)", assembled.payload.Rainfall_24h === 0);
  check("Water_Stress_Index never sent", !("Water_Stress_Index" in assembled.payload));
  check("Solar_Radiation missing → omitted", !("Solar_Radiation" in assembled.payload));
  check("categoricals use dataset labels", assembled.payload.Crop_Type === "Maize" && assembled.payload.Soil_Type === "Loamy"
    && assembled.payload.Growth_Stage === "Vegetative");
  check("historical moisture = avg of earlier readings (35)", assembled.payload.Historical_Soil_Moisture === 35);
  check("every feature is either sent or listed as missing",
    FEATURE_NAMES.every((n) => n in assembled.payload || assembled.missing.includes(n)));
  const cleared = await buildFeaturePayload(fieldA.fieldId, { Soil_Moisture: 22, Field_Slope: null });
  check("farmer clearing a value omits it", !("Field_Slope" in cleared.payload));

  check("mock: wet soil → No_Irrigation", mockPredict({ Soil_Moisture: 80 }) === "No_Irrigation");
  check("mock: heavy rain forecast → No_Irrigation", mockPredict({ Soil_Moisture: 35, Rainfall_Forecast_24h: 15 }) === "No_Irrigation");
  check("mock: dry + high ET0 → High", mockPredict({ Soil_Moisture: 20, Evaporation_Demand: 6 }) === "High");
  check("mock: dry, ET0 unknown → Medium", mockPredict({ Soil_Moisture: 20 }) === "Medium");
  check("mock: survives an empty payload", mockPredict({}) === "Low");

  const parsed = predictionInputSchema.parse({ fieldId: fieldA.fieldId, features: { Soil_Moisture: "22", Soil_pH: "" } });
  check("blank form value is not turned into 0", parsed.features.Soil_pH === undefined);
  const outcome = await predictions.createPrediction(farmer, parsed);
  check("mock prediction stored", outcome.mode === "mock" && outcome.action === "High", JSON.stringify(outcome.action));
  const stored = await predictions.getPrediction(farmer, outcome.predictionId);
  check("stored row: model_version mock-v1, omitted features NULL",
    stored.modelVersion === "mock-v1" && stored.solarRadiation === null && stored.waterStressIndex === null);
  check("estimated count matches NULL feature columns", outcome.estimatedCount === outcome.missing.length && outcome.estimatedCount > 0);
  await expectError("prediction on a field with no planting", "planting.none", async () => {
    const empty = await fields.createField(farmer, { farmId: farm.farmId, fieldName: "Empty", soilType: "Sandy", area: 1 });
    return buildFeaturePayload(empty.fieldId, { Soil_Moisture: 30 });
  });

  section("Validation");
  const bad = refillSchema.safeParse({ farmId: farm.farmId, quantityLitres: "" });
  check("empty litres → 'required/number' error, not 0", !bad.success);
}

main()
  .catch((e) => {
    failures.push(`crashed: ${e instanceof AppError ? e.key : e}`);
    console.error(e);
  })
  .finally(async () => {
    // Clean up: deleting a farm cascades to everything under it
    for (const farmId of createdFarms) {
      await db.orm.public.Farm.where({ farmId }).delete().catch((e: unknown) => console.error("cleanup", e));
    }
    if (tempUserId) await db.orm.public.Users.where({ userId: tempUserId }).delete().catch(() => {});
    await db.close();
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      for (const f of failures) console.log(`  - ${f}`);
      process.exitCode = 1;
    }
  });
