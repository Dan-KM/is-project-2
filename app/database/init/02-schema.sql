-- =====================================================================
-- Irrigation Action Recommendation Platform - Database Schema (v3)
-- Target: PostgreSQL 13+
--
-- v3: independent field water budgets (replaces v2's
--     "availability = farm balance x allocation %" model).
--
-- Water model
--   * One physical supply per farm: water_transaction ledger, balance >= 0.
--   * Each allocated field holds a virtual budget (field.remaining_budget_litres).
--   * Invariant: SUM(field budgets) <= farm balance  -> no litre is allocated twice.
--     unallocated = balance - SUM(budgets)
--   * Irrigation deducts from the farm balance AND the irrigating field's budget only.
--   * A budget at 0 (or a newly allocated field) is replenished with
--       TRUNC(allocation_percentage / 100 x unallocated, 2)
--     All waiting fields are replenished from the SAME unallocated snapshot, so
--     with active percentages capped at 100% in total, they never take more than
--     the pool holds. TRUNC rounds down, so rounding never over-allocates either.
--   * Replenishment runs when a budget hits 0, on refills / initial entry, and
--     when an allocation is added, changed or removed.
--
-- Maturity alerts use CURRENT_DATE (session time zone):
--   ALTER DATABASE <your_db> SET timezone TO 'Africa/Nairobi';
--
-- Custom SQLSTATEs
--   IR001  irrigation exceeds the farm's actual water balance
--   IR002  irrigation exceeds the field's remaining budget
--   IR003  field has no active allocation (so no budget)
--   IR004  integrity: field budgets would exceed the farm balance
--   IR005  integrity: IRRIGATION ledger row not charged to a field budget
-- =====================================================================

BEGIN;

-- Extensions need the superuser, so create this before switching roles
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- SET ROLE makes system_owner the owner of everything created below,
-- so future Prisma migrations (running as system_owner) can alter it.
SET ROLE system_owner;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- #####################################################################
-- TABLES
-- #####################################################################

-- =====================================================================
-- 1. users
-- =====================================================================
CREATE TABLE users (
    user_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_role      VARCHAR(30)  NOT NULL,
    first_name     VARCHAR(100) NOT NULL,
    last_name      VARCHAR(100) NOT NULL,
    email          VARCHAR(255) NOT NULL UNIQUE,
    phone          VARCHAR(20),
    password_hash  VARCHAR(255) NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_users_email_lower ON users (LOWER(email));

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- 2. farm
-- =====================================================================
CREATE TABLE farm (
    farm_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farmer_id   UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    farm_name   VARCHAR(150) NOT NULL,
    farm_address    VARCHAR(255) NOT NULL,
    latitude    NUMERIC(9,6)  NOT NULL CHECK (latitude  BETWEEN -90  AND 90),   -- negative = south
    longitude   NUMERIC(9,6)  NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    area        NUMERIC(10,4) NOT NULL CHECK (area > 0),                       -- hectares
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_farm_farmer ON farm (farmer_id);

CREATE TRIGGER trg_farm_updated_at
    BEFORE UPDATE ON farm
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- 3. field
-- =====================================================================
CREATE TABLE field (
    field_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id                  UUID NOT NULL REFERENCES farm(farm_id) ON DELETE CASCADE,
    field_name               VARCHAR(150) NOT NULL,
    soil_type                VARCHAR(50)  NOT NULL,
    area                     NUMERIC(10,4) NOT NULL CHECK (area > 0),
    field_slope              NUMERIC(5,2)  CHECK (field_slope >= 0),
    -- v3: replaces v2's water_availability_litres (renamed because its meaning changed:
    -- it is now an independent budget, not a share of the tank).
    -- NULL = no active allocation; 0 = exhausted, waiting for unallocated water.
    -- Written only through apply_field_budget_change() and the ledger undo guard.
    remaining_budget_litres  NUMERIC(12,2) CHECK (remaining_budget_litres >= 0),
    created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (farm_id, field_name)
);

CREATE INDEX idx_field_farm ON field (farm_id);

-- Budget changes deliberately don't bump updated_at
CREATE TRIGGER trg_field_updated_at
    BEFORE UPDATE OF farm_id, field_name, soil_type, area, field_slope ON field
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- 4. crop
-- =====================================================================
CREATE TABLE crop (
    crop_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    crop_name         VARCHAR(100) NOT NULL UNIQUE,
    crop_type         VARCHAR(50)  NOT NULL,
    crop_coefficient  NUMERIC(4,3) CHECK (crop_coefficient > 0),
    days_to_maturity  INTEGER      CHECK (days_to_maturity > 0),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_crop_updated_at
    BEFORE UPDATE ON crop
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- 5. field_crop
-- =====================================================================
CREATE TABLE field_crop (
    field_crop_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_id       UUID NOT NULL REFERENCES field(field_id) ON DELETE CASCADE,
    crop_id        UUID NOT NULL REFERENCES crop(crop_id)  ON DELETE RESTRICT,
    planting_date  DATE        NOT NULL,
    is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_field_crop_field  ON field_crop (field_id);
CREATE INDEX idx_field_crop_crop   ON field_crop (crop_id);
CREATE INDEX idx_field_crop_active ON field_crop (field_id) WHERE is_active;

CREATE TRIGGER trg_field_crop_updated_at
    BEFORE UPDATE ON field_crop
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- 6. crop_evolution
-- =====================================================================
CREATE TABLE crop_evolution (
    evolution_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_crop_id        UUID NOT NULL REFERENCES field_crop(field_crop_id) ON DELETE CASCADE,
    recorded_at          TIMESTAMPTZ  NOT NULL,
    growth_stage         VARCHAR(50)  NOT NULL,
    root_zone_depth      NUMERIC(5,3) CHECK (root_zone_depth >= 0),
    leaf_area_index      NUMERIC(5,2) CHECK (leaf_area_index >= 0),
    days_since_planting  INTEGER      CHECK (days_since_planting >= 0)
);

CREATE INDEX idx_crop_evolution_fc_time ON crop_evolution (field_crop_id, recorded_at DESC);


-- =====================================================================
-- 7. weather_data
-- =====================================================================
CREATE TABLE weather_data (
    weather_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id                  UUID NOT NULL REFERENCES farm(farm_id) ON DELETE CASCADE,
    date_time                TIMESTAMPTZ NOT NULL,
    record_type              VARCHAR(20) NOT NULL
                             CHECK (record_type IN ('historical', 'observed', 'forecast')),
    ambient_temperature      NUMERIC(5,2),
    relative_humidity        NUMERIC(5,2) CHECK (relative_humidity BETWEEN 0 AND 100),
    rainfall_24h             NUMERIC(7,2) CHECK (rainfall_24h >= 0),
    rainfall_forecast_24h    NUMERIC(7,2) CHECK (rainfall_forecast_24h >= 0),
    solar_radiation          NUMERIC(7,3) CHECK (solar_radiation >= 0),          -- MJ/m²/day (confirm)
    evapotranspiration_rate  NUMERIC(6,3) CHECK (evapotranspiration_rate >= 0),  -- ET0 mm/day (confirm)
    wind_speed               NUMERIC(5,2) CHECK (wind_speed >= 0),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (farm_id, date_time, record_type)
);

CREATE INDEX idx_weather_farm_time ON weather_data (farm_id, date_time DESC);


-- =====================================================================
-- 8. field_conditions
-- =====================================================================
CREATE TABLE field_conditions (
    field_conditions_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_id                    UUID NOT NULL REFERENCES field(field_id) ON DELETE CASCADE,
    date_time                   TIMESTAMPTZ NOT NULL,
    soil_moisture               NUMERIC(5,2) CHECK (soil_moisture BETWEEN 0 AND 100),
    soil_temperature            NUMERIC(5,2),
    soil_ph                     NUMERIC(4,2) CHECK (soil_ph BETWEEN 0 AND 14),
    soil_ec                     NUMERIC(7,3) CHECK (soil_ec >= 0),
    -- v3: snapshot of field.remaining_budget_litres at observation time (auto-filled if NULL).
    -- Name kept because it is a model feature.
    water_availability          NUMERIC(12,2) CHECK (water_availability >= 0),
    previous_irrigation_amount  NUMERIC(12,2) CHECK (previous_irrigation_amount >= 0),
    days_since_last_irrigation  INTEGER       CHECK (days_since_last_irrigation >= 0),
    water_stress_index          NUMERIC(5,3),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_field_conditions_field_time ON field_conditions (field_id, date_time DESC);


-- =====================================================================
-- 9. water_transaction  (physical ledger; unchanged from v2)
-- =====================================================================
CREATE TABLE water_transaction (
    transaction_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id                  UUID NOT NULL REFERENCES farm(farm_id) ON DELETE CASCADE,
    ledger_seq               INTEGER     NOT NULL,   -- per-farm order, set under lock by trigger
    transaction_type         VARCHAR(20) NOT NULL
                             CHECK (transaction_type IN ('INITIAL_ENTRY', 'REFILL', 'IRRIGATION')),
    quantity_litres          NUMERIC(12,2) NOT NULL,
    transaction_date         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    current_quantity_litres  NUMERIC(12,2) NOT NULL CHECK (current_quantity_litres >= 0),  -- set by trigger
    notes                    TEXT,
    CONSTRAINT chk_water_txn_quantity CHECK (
        (transaction_type = 'INITIAL_ENTRY' AND quantity_litres >= 0)
        OR (transaction_type IN ('REFILL', 'IRRIGATION') AND quantity_litres > 0)
    ),
    CONSTRAINT uq_water_txn_farm_seq UNIQUE (farm_id, ledger_seq)
);

CREATE UNIQUE INDEX uq_water_txn_one_initial
    ON water_transaction (farm_id) WHERE transaction_type = 'INITIAL_ENTRY';

CREATE INDEX idx_water_txn_farm_date ON water_transaction (farm_id, transaction_date DESC);


-- =====================================================================
-- 10. water_allocation
-- v3 meaning: allocation_percentage = share of the UNALLOCATED pool a field
-- receives each time its budget is replenished (not a share of the tank).
-- =====================================================================
CREATE TABLE water_allocation (
    allocation_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_id               UUID NOT NULL REFERENCES field(field_id) ON DELETE CASCADE,
    allocation_percentage  NUMERIC(5,2) NOT NULL CHECK (allocation_percentage BETWEEN 0 AND 100),
    effective_from         TIMESTAMPTZ  NOT NULL,
    effective_until        TIMESTAMPTZ,
    is_active              BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CHECK (effective_until IS NULL OR effective_until > effective_from),
    CHECK (NOT is_active OR effective_until IS NULL)
);

CREATE UNIQUE INDEX uq_water_allocation_active_field
    ON water_allocation (field_id) WHERE is_active;

CREATE TRIGGER trg_water_allocation_updated_at
    BEFORE UPDATE ON water_allocation
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- 11. irrigation_event  (unchanged from v2)
-- =====================================================================
CREATE TABLE irrigation_event (
    event_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_crop_id         UUID NOT NULL REFERENCES field_crop(field_crop_id) ON DELETE CASCADE,
    transaction_id        UUID NOT NULL UNIQUE
                          REFERENCES water_transaction(transaction_id) ON DELETE CASCADE,
    quantity_used_litres  NUMERIC(12,2) NOT NULL CHECK (quantity_used_litres > 0),
    irrigation_date       TIMESTAMPTZ   NOT NULL,
    notes                 TEXT,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_irrigation_event_fc_date ON irrigation_event (field_crop_id, irrigation_date DESC);

CREATE TRIGGER trg_irrigation_event_updated_at
    BEFORE UPDATE ON irrigation_event
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- 12. irrigation_action_prediction
-- =====================================================================
CREATE TABLE irrigation_action_prediction (
    prediction_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_crop_id                UUID NOT NULL REFERENCES field_crop(field_crop_id) ON DELETE CASCADE,
    predicted_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    predicted_irrigation_action  VARCHAR(50) NOT NULL,
    crop_type                    VARCHAR(50) NOT NULL,
    growth_stage                 VARCHAR(50) NOT NULL,
    soil_type                    VARCHAR(50) NOT NULL,

    model_version                VARCHAR(50),
    prediction_confidence        NUMERIC(5,4) CHECK (prediction_confidence BETWEEN 0 AND 1),

    day_of_year                  SMALLINT CHECK (day_of_year BETWEEN 1 AND 366),
    time_of_day                  SMALLINT CHECK (time_of_day BETWEEN 0 AND 23),

    soil_moisture                NUMERIC(5,2) CHECK (soil_moisture BETWEEN 0 AND 100),
    soil_temperature             NUMERIC(5,2),
    soil_ph                      NUMERIC(4,2) CHECK (soil_ph BETWEEN 0 AND 14),
    soil_ec                      NUMERIC(7,3) CHECK (soil_ec >= 0),

    ambient_temperature          NUMERIC(5,2),
    relative_humidity            NUMERIC(5,2) CHECK (relative_humidity BETWEEN 0 AND 100),
    wind_speed                   NUMERIC(5,2) CHECK (wind_speed >= 0),
    solar_radiation              NUMERIC(7,3) CHECK (solar_radiation >= 0),
    rainfall_24h                 NUMERIC(7,2) CHECK (rainfall_24h >= 0),
    rainfall_forecast_24h        NUMERIC(7,2) CHECK (rainfall_forecast_24h >= 0),

    root_zone_depth              NUMERIC(5,3) CHECK (root_zone_depth >= 0),
    leaf_area_index              NUMERIC(5,2) CHECK (leaf_area_index >= 0),
    crop_coefficient             NUMERIC(4,3) CHECK (crop_coefficient > 0),
    field_slope                  NUMERIC(5,2) CHECK (field_slope >= 0),

    water_availability           NUMERIC(12,2) CHECK (water_availability >= 0),  -- v3: field budget snapshot
    previous_irrigation_amount   NUMERIC(12,2) CHECK (previous_irrigation_amount >= 0),
    days_since_last_irrigation   INTEGER       CHECK (days_since_last_irrigation >= 0),
    historical_soil_moisture     NUMERIC(5,2)  CHECK (historical_soil_moisture BETWEEN 0 AND 100),
    evaporation_demand           NUMERIC(6,3)  CHECK (evaporation_demand >= 0),
    water_stress_index           NUMERIC(5,3)
);

CREATE INDEX idx_prediction_fc_time ON irrigation_action_prediction (field_crop_id, predicted_at DESC);
CREATE INDEX idx_prediction_model   ON irrigation_action_prediction (model_version);


-- =====================================================================
-- 13. field_budget_transaction  (v3, new)
-- Audit trail of every change to a field's virtual budget: shows where each
-- litre came from (e.g. "15% of 6,000 L unallocated") and lets a ledger undo
-- reverse exactly the budget changes it caused.
-- =====================================================================
CREATE TABLE field_budget_transaction (
    budget_txn_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_id                   UUID NOT NULL REFERENCES field(field_id) ON DELETE CASCADE,
    -- Ledger row that caused this change (irrigation, refill...). NULL for allocation changes.
    water_transaction_id       UUID REFERENCES water_transaction(transaction_id) ON DELETE CASCADE,
    reason                     VARCHAR(20) NOT NULL CHECK (reason IN ('ALLOCATE', 'IRRIGATE', 'RELEASE')),
    change_litres              NUMERIC(12,2) NOT NULL,   -- signed: legitimately negative for IRRIGATE/RELEASE
    budget_after_litres        NUMERIC(12,2) CHECK (budget_after_litres >= 0),          -- NULL after RELEASE
    unallocated_before_litres  NUMERIC(12,2) CHECK (unallocated_before_litres >= 0),    -- ALLOCATE: pool used
    allocation_percentage      NUMERIC(5,2)  CHECK (allocation_percentage BETWEEN 0 AND 100),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (reason = 'ALLOCATE' AND change_litres >= 0)
        OR (reason IN ('IRRIGATE', 'RELEASE') AND change_litres <= 0)
    )
);

CREATE INDEX idx_budget_txn_field_time ON field_budget_transaction (field_id, created_at DESC);
CREATE INDEX idx_budget_txn_water_txn  ON field_budget_transaction (water_transaction_id);


-- #####################################################################
-- SECTION A: PHYSICAL LEDGER - LOCKING & BALANCE
-- Lock order everywhere: farm row first, then field rows.
-- #####################################################################

CREATE OR REPLACE FUNCTION lock_farm(p_farm_id UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM 1 FROM farm WHERE farm_id = p_farm_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Farm % not found', p_farm_id USING ERRCODE = 'foreign_key_violation';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Latest balance in ledger order; NULL before the INITIAL_ENTRY.
-- Only trustworthy for decisions when called after lock_farm().
CREATE OR REPLACE FUNCTION current_farm_balance(p_farm_id UUID)
RETURNS NUMERIC AS $$
    SELECT current_quantity_litres
    FROM water_transaction
    WHERE farm_id = p_farm_id
    ORDER BY ledger_seq DESC
    LIMIT 1;
$$ LANGUAGE sql;

-- BEFORE INSERT: lock -> read balance -> validate -> set balance + ledger_seq
CREATE OR REPLACE FUNCTION water_transaction_apply_balance()
RETURNS TRIGGER AS $$
DECLARE
    v_prev NUMERIC;
    v_new  NUMERIC;
BEGIN
    PERFORM lock_farm(NEW.farm_id);
    v_prev := current_farm_balance(NEW.farm_id);

    IF NEW.transaction_type = 'INITIAL_ENTRY' THEN
        IF v_prev IS NOT NULL THEN
            RAISE EXCEPTION 'Farm % already has water records; record a REFILL instead', NEW.farm_id;
        END IF;
        v_new := NEW.quantity_litres;

    ELSIF v_prev IS NULL THEN
        RAISE EXCEPTION 'Farm % has no INITIAL_ENTRY yet', NEW.farm_id;

    ELSIF NEW.transaction_type = 'REFILL' THEN
        v_new := v_prev + NEW.quantity_litres;

    ELSE
        v_new := v_prev - NEW.quantity_litres;
        IF v_new < 0 THEN
            RAISE EXCEPTION 'Insufficient water: farm % has % L, irrigation needs % L',
                NEW.farm_id, v_prev, NEW.quantity_litres
                USING ERRCODE = 'IR001',
                      HINT = 'Record a REFILL or reduce the irrigation amount.';
        END IF;
    END IF;

    NEW.current_quantity_litres := v_new;
    NEW.ledger_seq := COALESCE(
        (SELECT MAX(ledger_seq) FROM water_transaction WHERE farm_id = NEW.farm_id), 0) + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_water_txn_apply_balance
    BEFORE INSERT ON water_transaction
    FOR EACH ROW EXECUTE FUNCTION water_transaction_apply_balance();

-- BEFORE UPDATE/DELETE
--   UPDATE: only notes / transaction_date may change.
--   DELETE: only the farm's latest row (undo). v3: also reverses exactly the
--           budget changes that row caused, then checks the smaller balance
--           still covers every remaining budget.
CREATE OR REPLACE FUNCTION water_transaction_guard()
RETURNS TRIGGER AS $$
DECLARE
    r               RECORD;
    v_budget        NUMERIC;
    v_balance_after NUMERIC;
    v_allocated     NUMERIC;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.farm_id, NEW.ledger_seq, NEW.transaction_type,
            NEW.quantity_litres, NEW.current_quantity_litres)
           IS DISTINCT FROM
           (OLD.farm_id, OLD.ledger_seq, OLD.transaction_type,
            OLD.quantity_litres, OLD.current_quantity_litres) THEN
            RAISE EXCEPTION 'Ledger amounts are immutable; delete the latest entry and re-record it, or add a new entry';
        END IF;
        RETURN NEW;
    END IF;

    -- Farm already gone = farm-delete cascade: nothing to protect
    IF NOT EXISTS (SELECT 1 FROM farm WHERE farm_id = OLD.farm_id) THEN
        RETURN OLD;
    END IF;

    PERFORM lock_farm(OLD.farm_id);

    IF OLD.ledger_seq <> (SELECT MAX(ledger_seq) FROM water_transaction WHERE farm_id = OLD.farm_id) THEN
        RAISE EXCEPTION 'Only the latest transaction of farm % can be deleted', OLD.farm_id;
    END IF;

    -- Reverse this entry's budget effects (irrigation deduction, replenishments it triggered)
    FOR r IN
        SELECT field_id, SUM(change_litres) AS delta
        FROM field_budget_transaction
        WHERE water_transaction_id = OLD.transaction_id
        GROUP BY field_id
    LOOP
        SELECT remaining_budget_litres INTO v_budget
        FROM field WHERE field_id = r.field_id FOR UPDATE;

        CONTINUE WHEN v_budget IS NULL;   -- allocation removed since; that water is already back in the pool

        IF v_budget - r.delta < 0 THEN
            RAISE EXCEPTION 'Cannot undo: budget granted by this entry to field % has already been used', r.field_id;
        END IF;

        UPDATE field SET remaining_budget_litres = v_budget - r.delta WHERE field_id = r.field_id;
    END LOOP;
    -- (its field_budget_transaction rows are removed by ON DELETE CASCADE)

    v_balance_after := COALESCE(
        (SELECT current_quantity_litres FROM water_transaction
         WHERE farm_id = OLD.farm_id AND ledger_seq = OLD.ledger_seq - 1), 0);

    SELECT COALESCE(SUM(remaining_budget_litres), 0) INTO v_allocated
    FROM field WHERE farm_id = OLD.farm_id;

    IF v_allocated > v_balance_after THEN
        RAISE EXCEPTION 'Cannot undo: balance would drop to % L but % L is allocated to field budgets',
            v_balance_after, v_allocated
            USING ERRCODE = 'IR004';
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_water_txn_guard
    BEFORE UPDATE OR DELETE ON water_transaction
    FOR EACH ROW EXECUTE FUNCTION water_transaction_guard();


-- #####################################################################
-- SECTION B: FIELD BUDGETS
-- #####################################################################

-- The single write path for budgets: update + audit row together
CREATE OR REPLACE FUNCTION apply_field_budget_change(
    p_field_id      UUID,
    p_new_budget    NUMERIC,              -- NULL = release (no allocation)
    p_reason        TEXT,
    p_water_txn_id  UUID    DEFAULT NULL,
    p_unallocated   NUMERIC DEFAULT NULL,
    p_percentage    NUMERIC DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_old NUMERIC;
BEGIN
    SELECT remaining_budget_litres INTO v_old FROM field WHERE field_id = p_field_id FOR UPDATE;

    UPDATE field SET remaining_budget_litres = p_new_budget WHERE field_id = p_field_id;

    INSERT INTO field_budget_transaction
        (field_id, water_transaction_id, reason, change_litres,
         budget_after_litres, unallocated_before_litres, allocation_percentage)
    VALUES
        (p_field_id, p_water_txn_id, p_reason, COALESCE(p_new_budget, 0) - COALESCE(v_old, 0),
         p_new_budget, p_unallocated, p_percentage);
END;
$$ LANGUAGE plpgsql;

-- Replenish every field on the farm that has an active allocation and a
-- budget of 0 (exhausted) or NULL (newly allocated):
--   unallocated = balance - SUM(all budgets)      (waiting fields contribute 0)
--   new_budget  = TRUNC(pct / 100 x unallocated, 2)
-- All waiting fields share ONE unallocated snapshot. Active percentages total
-- <= 100%, so SUM(new budgets) <= unallocated: no litre allocated twice,
-- independent of processing order. If unallocated is 0 the field stays at 0
-- (exhausted) and is retried on the next refill / release.
-- Returns total litres allocated.
CREATE OR REPLACE FUNCTION replenish_exhausted_budgets(
    p_farm_id       UUID,
    p_water_txn_id  UUID DEFAULT NULL     -- ledger row that freed the water, for audit/undo
)
RETURNS NUMERIC AS $$
DECLARE
    r              RECORD;
    v_balance      NUMERIC;
    v_allocated    NUMERIC;
    v_unallocated  NUMERIC;
    v_new          NUMERIC;
    v_total        NUMERIC := 0;
BEGIN
    PERFORM 1 FROM farm WHERE farm_id = p_farm_id FOR UPDATE;   -- usually already held
    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    v_balance := COALESCE(current_farm_balance(p_farm_id), 0);

    SELECT COALESCE(SUM(remaining_budget_litres), 0) INTO v_allocated
    FROM field WHERE farm_id = p_farm_id;

    v_unallocated := v_balance - v_allocated;
    IF v_unallocated < 0 THEN
        RAISE EXCEPTION 'Integrity error: farm % has % L allocated but only % L in the tank',
            p_farm_id, v_allocated, v_balance USING ERRCODE = 'IR004';
    END IF;

    FOR r IN
        SELECT f.field_id, f.remaining_budget_litres, wa.allocation_percentage
        FROM field f
        JOIN water_allocation wa ON wa.field_id = f.field_id AND wa.is_active
        WHERE f.farm_id = p_farm_id
          AND COALESCE(f.remaining_budget_litres, 0) = 0
        ORDER BY f.field_id
        FOR UPDATE OF f
    LOOP
        v_new := TRUNC(v_unallocated * r.allocation_percentage / 100, 2);   -- round DOWN

        -- NULL -> value always written (field becomes "allocated", even at 0);
        -- 0 -> 0 is a no-op, so skip the audit noise
        IF r.remaining_budget_litres IS NULL OR v_new > 0 THEN
            PERFORM apply_field_budget_change(r.field_id, v_new, 'ALLOCATE', p_water_txn_id,
                                              v_unallocated, r.allocation_percentage);
        END IF;

        v_total := v_total + v_new;
    END LOOP;

    RETURN v_total;
END;
$$ LANGUAGE plpgsql;

-- Bring one field's budget in line with its allocation state:
--   no active allocation, budget set -> RELEASE (water returns to the pool)
--   active allocation, budget NULL/0 -> replenish
--   active allocation, budget > 0    -> untouched (a % change applies at the next replenishment)
-- Then let any waiting fields claim freed water.
CREATE OR REPLACE FUNCTION sync_field_budget(p_field_id UUID)
RETURNS VOID AS $$
DECLARE
    v_farm_id UUID;
    v_budget  NUMERIC;
BEGIN
    SELECT farm_id INTO v_farm_id FROM field WHERE field_id = p_field_id;
    IF NOT FOUND THEN
        RETURN;                                       -- field deleted
    END IF;

    PERFORM 1 FROM farm WHERE farm_id = v_farm_id FOR UPDATE;   -- farm before field
    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT remaining_budget_litres INTO v_budget FROM field WHERE field_id = p_field_id FOR UPDATE;

    IF v_budget IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM water_allocation WHERE field_id = p_field_id AND is_active) THEN
        PERFORM apply_field_budget_change(p_field_id, NULL, 'RELEASE');
    END IF;

    PERFORM replenish_exhausted_budgets(v_farm_id);
END;
$$ LANGUAGE plpgsql;

-- Active percentages per farm must total <= 100%.
-- This is what makes simultaneous replenishment safe.
CREATE OR REPLACE FUNCTION check_farm_allocation_total()
RETURNS TRIGGER AS $$
DECLARE
    v_farm_id UUID;
    v_total   NUMERIC;
BEGIN
    IF NOT NEW.is_active THEN
        RETURN NEW;
    END IF;

    SELECT farm_id INTO v_farm_id FROM field WHERE field_id = NEW.field_id;
    PERFORM lock_farm(v_farm_id);

    SELECT COALESCE(SUM(wa.allocation_percentage), 0) INTO v_total
    FROM water_allocation wa
    JOIN field f ON f.field_id = wa.field_id
    WHERE f.farm_id = v_farm_id
      AND wa.is_active
      AND wa.allocation_id <> NEW.allocation_id;

    IF v_total + NEW.allocation_percentage > 100 THEN
        RAISE EXCEPTION 'Active allocations for farm % would total % percent (max 100)',
            v_farm_id, v_total + NEW.allocation_percentage
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_water_allocation_cap
    BEFORE INSERT OR UPDATE ON water_allocation
    FOR EACH ROW EXECUTE FUNCTION check_farm_allocation_total();

-- Allocation changes -> sync budgets. DEFERRED to commit so a "close old row,
-- open new row" percentage change is seen as one change (budget carried over),
-- not as release-then-fresh-allocation. set_field_allocation() also syncs
-- immediately; running it again at commit is a no-op.
CREATE OR REPLACE FUNCTION trg_fn_allocation_sync()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM sync_field_budget(OLD.field_id);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM sync_field_budget(NEW.field_id);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_water_allocation_sync
    AFTER INSERT OR UPDATE OR DELETE ON water_allocation
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION trg_fn_allocation_sync();

-- Refills / initial entry add water -> waiting fields may claim it.
-- (Trigger, not just the API functions, so raw INSERTs behave the same.)
CREATE OR REPLACE FUNCTION trg_fn_water_in_replenish()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM replenish_exhausted_budgets(NEW.farm_id, NEW.transaction_id);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_water_txn_replenish
    AFTER INSERT ON water_transaction
    FOR EACH ROW
    WHEN (NEW.transaction_type IN ('INITIAL_ENTRY', 'REFILL'))
    EXECUTE FUNCTION trg_fn_water_in_replenish();

-- INTEGRITY BACKSTOP: SUM(budgets) <= farm balance, checked at COMMIT.
-- Deferred because irrigation briefly lowers the balance before deducting the
-- budget within the same transaction. Locks the farm so two concurrent
-- transactions can't both pass with stale snapshots.
CREATE OR REPLACE FUNCTION check_farm_budget_invariant()
RETURNS TRIGGER AS $$
DECLARE
    v_farm_id    UUID;
    v_balance    NUMERIC;
    v_allocated  NUMERIC;
BEGIN
    v_farm_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.farm_id ELSE NEW.farm_id END;

    PERFORM 1 FROM farm WHERE farm_id = v_farm_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    v_balance := COALESCE(current_farm_balance(v_farm_id), 0);
    SELECT COALESCE(SUM(remaining_budget_litres), 0) INTO v_allocated
    FROM field WHERE farm_id = v_farm_id;

    IF v_allocated > v_balance THEN
        RAISE EXCEPTION 'Field budgets on farm % total % L but the tank holds only % L',
            v_farm_id, v_allocated, v_balance
            USING ERRCODE = 'IR004';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_field_budget_invariant
    AFTER INSERT OR UPDATE OF remaining_budget_litres, farm_id ON field
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_farm_budget_invariant();

CREATE CONSTRAINT TRIGGER trg_water_txn_budget_invariant
    AFTER INSERT OR DELETE ON water_transaction
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_farm_budget_invariant();

-- INTEGRITY BACKSTOP: every IRRIGATION ledger row must have its irrigation_event
-- and be charged to a field budget, checked at COMMIT. Stops raw INSERTs from
-- spending water while skipping the budget rules.
CREATE OR REPLACE FUNCTION check_irrigation_charged()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM water_transaction WHERE transaction_id = NEW.transaction_id) THEN
        RETURN NULL;   -- undone later in the same transaction
    END IF;

    IF NOT EXISTS (SELECT 1 FROM irrigation_event WHERE transaction_id = NEW.transaction_id)
       OR NOT EXISTS (SELECT 1 FROM field_budget_transaction
                      WHERE water_transaction_id = NEW.transaction_id
                        AND reason = 'IRRIGATE'
                        AND change_litres = -NEW.quantity_litres) THEN
        RAISE EXCEPTION 'IRRIGATION transaction % was not recorded through record_irrigation()', NEW.transaction_id
            USING ERRCODE = 'IR005';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_water_txn_irrigation_charged
    AFTER INSERT ON water_transaction
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    WHEN (NEW.transaction_type = 'IRRIGATION')
    EXECUTE FUNCTION check_irrigation_charged();

-- field_conditions.water_availability: snapshot the field's budget if left NULL
CREATE OR REPLACE FUNCTION field_conditions_snapshot_availability()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.water_availability IS NULL THEN
        SELECT remaining_budget_litres INTO NEW.water_availability
        FROM field WHERE field_id = NEW.field_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_field_conditions_snapshot
    BEFORE INSERT ON field_conditions
    FOR EACH ROW EXECUTE FUNCTION field_conditions_snapshot_availability();


-- #####################################################################
-- SECTION C: FARM AREA VALIDATION  (unchanged from v2)
-- #####################################################################

CREATE OR REPLACE FUNCTION check_field_area_within_farm()
RETURNS TRIGGER AS $$
DECLARE
    v_farm_area NUMERIC;
    v_used      NUMERIC;
BEGIN
    SELECT area INTO v_farm_area FROM farm WHERE farm_id = NEW.farm_id FOR UPDATE;

    SELECT COALESCE(SUM(area), 0) INTO v_used
    FROM field
    WHERE farm_id = NEW.farm_id
      AND field_id <> NEW.field_id;

    IF v_used + NEW.area > v_farm_area THEN
        RAISE EXCEPTION 'Fields on farm % would cover % ha, but the farm is only % ha',
            NEW.farm_id, v_used + NEW.area, v_farm_area
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_field_area_cap
    BEFORE INSERT OR UPDATE OF area, farm_id ON field
    FOR EACH ROW EXECUTE FUNCTION check_field_area_within_farm();

CREATE OR REPLACE FUNCTION check_farm_area_covers_fields()
RETURNS TRIGGER AS $$
DECLARE
    v_used NUMERIC;
BEGIN
    SELECT COALESCE(SUM(area), 0) INTO v_used FROM field WHERE farm_id = NEW.farm_id;

    IF v_used > NEW.area THEN
        RAISE EXCEPTION 'Farm % cannot shrink to % ha: its fields already cover % ha',
            NEW.farm_id, NEW.area, v_used
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_farm_area_shrink
    BEFORE UPDATE OF area ON farm
    FOR EACH ROW
    WHEN (NEW.area < OLD.area)
    EXECUTE FUNCTION check_farm_area_covers_fields();


-- #####################################################################
-- SECTION D: TRANSACTIONAL API FUNCTIONS
-- Each call is atomic: any exception rolls back everything it did.
-- #####################################################################

CREATE OR REPLACE FUNCTION record_initial_water_entry(
    p_farm_id          UUID,
    p_quantity_litres  NUMERIC,
    p_date             TIMESTAMPTZ DEFAULT now(),
    p_notes            TEXT DEFAULT NULL
)
RETURNS water_transaction AS $$
DECLARE
    v_row water_transaction;
BEGIN
    PERFORM lock_farm(p_farm_id);

    IF current_farm_balance(p_farm_id) IS NOT NULL THEN
        RAISE EXCEPTION 'Farm % already has an initial entry; record a refill instead', p_farm_id;
    END IF;

    INSERT INTO water_transaction (farm_id, transaction_type, quantity_litres, transaction_date, notes)
    VALUES (p_farm_id, 'INITIAL_ENTRY', p_quantity_litres, p_date, p_notes)
    RETURNING * INTO v_row;       -- trg_water_txn_replenish funds any already-allocated fields

    RETURN v_row;
END;
$$ LANGUAGE plpgsql;

-- Refill: raises the balance only. Existing budgets are untouched; the new
-- water joins the unallocated pool and only waiting (0 / new) fields draw from it.
CREATE OR REPLACE FUNCTION record_water_refill(
    p_farm_id          UUID,
    p_quantity_litres  NUMERIC,
    p_date             TIMESTAMPTZ DEFAULT now(),
    p_notes            TEXT DEFAULT NULL
)
RETURNS water_transaction AS $$
DECLARE
    v_row water_transaction;
BEGIN
    PERFORM lock_farm(p_farm_id);

    IF current_farm_balance(p_farm_id) IS NULL THEN
        RAISE EXCEPTION 'Farm % has no initial water entry yet', p_farm_id;
    END IF;

    INSERT INTO water_transaction (farm_id, transaction_type, quantity_litres, transaction_date, notes)
    VALUES (p_farm_id, 'REFILL', p_quantity_litres, p_date, p_notes)
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$ LANGUAGE plpgsql;

-- Advisory pre-check for the UI (no locks, no writes): lets the app warn
-- before submitting. record_irrigation() re-validates under the lock.
CREATE OR REPLACE FUNCTION check_irrigation_request(
    p_field_crop_id    UUID,
    p_quantity_litres  NUMERIC
)
RETURNS TABLE (
    allowed              BOOLEAN,
    reason_code          TEXT,     -- OK | EXCEEDS_FIELD_BUDGET | EXCEEDS_FARM_BALANCE | NO_ALLOCATION | ...
    max_litres           NUMERIC,  -- most that could be irrigated right now
    field_budget_litres  NUMERIC,
    farm_balance_litres  NUMERIC
) AS $$
    SELECT
        s.reason = 'OK',
        s.reason,
        CASE WHEN s.budget IS NULL OR s.balance IS NULL THEN 0
             ELSE LEAST(s.budget, s.balance) END,
        s.budget,
        s.balance
    FROM (
        SELECT
            f.remaining_budget_litres AS budget,
            bal.balance,
            CASE
                WHEN NOT fc.is_active                                  THEN 'PLANTING_INACTIVE'
                WHEN bal.balance IS NULL                               THEN 'NO_WATER_RECORDS'
                WHEN f.remaining_budget_litres IS NULL                 THEN 'NO_ALLOCATION'
                WHEN p_quantity_litres IS NULL OR p_quantity_litres <= 0 THEN 'INVALID_AMOUNT'
                WHEN p_quantity_litres > f.remaining_budget_litres     THEN 'EXCEEDS_FIELD_BUDGET'
                WHEN p_quantity_litres > bal.balance                   THEN 'EXCEEDS_FARM_BALANCE'
                ELSE 'OK'
            END AS reason
        FROM field_crop fc
        JOIN field f ON f.field_id = fc.field_id
        CROSS JOIN LATERAL (SELECT current_farm_balance(f.farm_id) AS balance) bal
        WHERE fc.field_crop_id = p_field_crop_id
    ) s;
$$ LANGUAGE sql;

-- Irrigation: deduct from farm balance AND this field's budget only.
-- Errors (nothing written):
--   IR003 no allocation | IR002 > field budget | IR001 > farm balance
-- Success returns a status: OK | BUDGET_REPLENISHED | BUDGET_EXHAUSTED
CREATE OR REPLACE FUNCTION record_irrigation(
    p_field_crop_id    UUID,
    p_quantity_litres  NUMERIC,
    p_irrigation_date  TIMESTAMPTZ DEFAULT now(),
    p_notes            TEXT DEFAULT NULL
)
RETURNS TABLE (
    event_id             UUID,
    transaction_id       UUID,
    farm_balance_litres  NUMERIC,   -- after irrigation
    field_budget_litres  NUMERIC,   -- after irrigation and any replenishment
    replenished_litres   NUMERIC,   -- budget added because it reached 0 (0 if none)
    status_code          TEXT,
    status_message       TEXT
) AS $$
#variable_conflict use_column
DECLARE
    v_field_id       UUID;
    v_farm_id        UUID;
    v_active         BOOLEAN;
    v_balance        NUMERIC;
    v_budget         NUMERIC;
    v_txn_id         UUID;
    v_event_id       UUID;
    v_balance_after  NUMERIC;
    v_budget_after   NUMERIC;
    v_replenished    NUMERIC := 0;
    v_code           TEXT := 'OK';
    v_msg            TEXT;
BEGIN
    SELECT fc.field_id, f.farm_id, fc.is_active
    INTO v_field_id, v_farm_id, v_active
    FROM field_crop fc
    JOIN field f ON f.field_id = fc.field_id
    WHERE fc.field_crop_id = p_field_crop_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Planting % not found', p_field_crop_id;
    ELSIF NOT v_active THEN
        RAISE EXCEPTION 'Planting % is no longer active', p_field_crop_id;
    ELSIF p_quantity_litres IS NULL OR p_quantity_litres <= 0 THEN
        RAISE EXCEPTION 'Irrigation amount must be greater than 0';
    END IF;

    -- 1. Lock farm, then field.  2. Read balance + budget after the locks.
    PERFORM lock_farm(v_farm_id);
    v_balance := current_farm_balance(v_farm_id);
    SELECT remaining_budget_litres INTO v_budget FROM field WHERE field_id = v_field_id FOR UPDATE;

    -- 3. Validate both limits
    IF v_balance IS NULL THEN
        RAISE EXCEPTION 'Farm % has no initial water entry yet', v_farm_id;
    END IF;

    IF v_budget IS NULL THEN
        RAISE EXCEPTION 'This field has no active water allocation, so it has no budget to irrigate from'
            USING ERRCODE = 'IR003',
                  HINT = 'Give the field an allocation with set_field_allocation().';
    END IF;

    IF p_quantity_litres > v_budget THEN
        RAISE EXCEPTION 'Requested % L exceeds this field''s remaining budget of % L', p_quantity_litres, v_budget
            USING ERRCODE = 'IR002',
                  HINT = CASE WHEN v_budget = 0
                              THEN 'The budget is exhausted and there is no unallocated water; record a refill.'
                              ELSE format('Irrigate at most %s L now. The budget is replenished once it reaches 0.', v_budget)
                         END;
    END IF;

    -- Unreachable while SUM(budgets) <= balance holds; kept as defence in depth
    IF p_quantity_litres > v_balance THEN
        RAISE EXCEPTION 'Insufficient water: farm has % L, irrigation needs % L', v_balance, p_quantity_litres
            USING ERRCODE = 'IR001';
    END IF;

    -- 4. Write ledger row, event, and budget deduction atomically
    INSERT INTO water_transaction (farm_id, transaction_type, quantity_litres, transaction_date, notes)
    VALUES (v_farm_id, 'IRRIGATION', p_quantity_litres, p_irrigation_date, p_notes)
    RETURNING transaction_id, current_quantity_litres INTO v_txn_id, v_balance_after;

    INSERT INTO irrigation_event (field_crop_id, transaction_id, quantity_used_litres, irrigation_date, notes)
    VALUES (p_field_crop_id, v_txn_id, p_quantity_litres, p_irrigation_date, p_notes)
    RETURNING event_id INTO v_event_id;

    PERFORM apply_field_budget_change(v_field_id, v_budget - p_quantity_litres, 'IRRIGATE', v_txn_id);

    -- 5. Budget used up -> replenish from unallocated water
    IF v_budget - p_quantity_litres = 0 THEN
        PERFORM replenish_exhausted_budgets(v_farm_id, v_txn_id);
    END IF;

    SELECT remaining_budget_litres INTO v_budget_after FROM field WHERE field_id = v_field_id;

    IF v_budget - p_quantity_litres = 0 THEN
        v_replenished := v_budget_after;
        IF v_budget_after > 0 THEN
            v_code := 'BUDGET_REPLENISHED';
            v_msg  := format('Budget used up and replenished with %s L from unallocated water.', v_budget_after);
        ELSE
            v_code := 'BUDGET_EXHAUSTED';
            v_msg  := 'Budget used up and no unallocated water is available. This field can''t irrigate until a refill.';
        END IF;
    END IF;

    event_id            := v_event_id;
    transaction_id      := v_txn_id;
    farm_balance_litres := v_balance_after;
    field_budget_litres := v_budget_after;
    replenished_litres  := v_replenished;
    status_code         := v_code;
    status_message      := v_msg;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- Direct irrigation_event writes must match their ledger row
CREATE OR REPLACE FUNCTION check_irrigation_event_txn()
RETURNS TRIGGER AS $$
DECLARE
    v_txn_type  VARCHAR(20);
    v_txn_farm  UUID;
    v_txn_qty   NUMERIC;
    v_crop_farm UUID;
BEGIN
    SELECT transaction_type, farm_id, quantity_litres
    INTO v_txn_type, v_txn_farm, v_txn_qty
    FROM water_transaction WHERE transaction_id = NEW.transaction_id;

    SELECT f.farm_id INTO v_crop_farm
    FROM field_crop fc JOIN field f ON f.field_id = fc.field_id
    WHERE fc.field_crop_id = NEW.field_crop_id;

    IF v_txn_type <> 'IRRIGATION' THEN
        RAISE EXCEPTION 'Transaction % is %, expected IRRIGATION', NEW.transaction_id, v_txn_type;
    ELSIF v_txn_farm <> v_crop_farm THEN
        RAISE EXCEPTION 'Transaction farm and field farm do not match';
    ELSIF NEW.quantity_used_litres <> v_txn_qty THEN
        RAISE EXCEPTION 'Event uses % L but its ledger transaction records % L',
            NEW.quantity_used_litres, v_txn_qty;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_irrigation_event_txn_check
    BEFORE INSERT OR UPDATE ON irrigation_event
    FOR EACH ROW EXECUTE FUNCTION check_irrigation_event_txn();

-- Allocation change. A % change keeps the current budget (no silent
-- invalidation, no over-allocation); the new % applies at the next
-- replenishment. p_percentage = NULL removes the allocation and releases the
-- budget back to the unallocated pool.
CREATE OR REPLACE FUNCTION set_field_allocation(
    p_field_id        UUID,
    p_percentage      NUMERIC,
    p_effective_from  TIMESTAMPTZ DEFAULT now()
)
RETURNS water_allocation AS $$
DECLARE
    v_farm_id UUID;
    v_row     water_allocation;
BEGIN
    SELECT farm_id INTO v_farm_id FROM field WHERE field_id = p_field_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Field % not found', p_field_id;
    END IF;

    PERFORM lock_farm(v_farm_id);

    UPDATE water_allocation
    SET is_active = FALSE,
        effective_until = p_effective_from
    WHERE field_id = p_field_id
      AND is_active;

    IF p_percentage IS NOT NULL THEN
        INSERT INTO water_allocation (field_id, allocation_percentage, effective_from)
        VALUES (p_field_id, p_percentage, p_effective_from)
        RETURNING * INTO v_row;
    END IF;

    PERFORM sync_field_budget(p_field_id);   -- immediate, so the caller sees the new budget

    RETURN v_row;
END;
$$ LANGUAGE plpgsql;

-- Crop planting change. Budgets belong to the field, not the planting, so
-- replanting doesn't touch water. Locks the field.
CREATE OR REPLACE FUNCTION replace_field_crop(
    p_field_id       UUID,
    p_crop_id        UUID,
    p_planting_date  DATE DEFAULT CURRENT_DATE
)
RETURNS field_crop AS $$
DECLARE
    v_row field_crop;
BEGIN
    PERFORM 1 FROM field WHERE field_id = p_field_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Field % not found', p_field_id;
    END IF;

    UPDATE field_crop
    SET is_active = FALSE
    WHERE field_id = p_field_id
      AND is_active;

    INSERT INTO field_crop (field_id, crop_id, planting_date)
    VALUES (p_field_id, p_crop_id, p_planting_date)
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$ LANGUAGE plpgsql;


-- #####################################################################
-- SECTION E: VIEWS
-- #####################################################################

-- Farm-level split: tank = allocated budgets + unallocated pool
CREATE OR REPLACE VIEW farm_water_status AS
SELECT
    fm.farm_id,
    fm.farm_name,
    COALESCE(current_farm_balance(fm.farm_id), 0)                     AS balance_litres,
    COALESCE(SUM(f.remaining_budget_litres), 0)                       AS allocated_litres,
    COALESCE(current_farm_balance(fm.farm_id), 0)
        - COALESCE(SUM(f.remaining_budget_litres), 0)                 AS unallocated_litres
FROM farm fm
LEFT JOIN field f ON f.farm_id = fm.farm_id
GROUP BY fm.farm_id, fm.farm_name;

-- Per-field budget state for dashboards
CREATE OR REPLACE VIEW field_budget_status AS
SELECT
    f.field_id,
    f.farm_id,
    f.field_name,
    wa.allocation_percentage,
    f.remaining_budget_litres,
    CASE
        WHEN wa.allocation_id IS NULL        THEN 'NO_ALLOCATION'
        WHEN f.remaining_budget_litres = 0   THEN 'EXHAUSTED'
        ELSE 'AVAILABLE'
    END AS budget_status
FROM field f
LEFT JOIN water_allocation wa ON wa.field_id = f.field_id AND wa.is_active;

-- Crop maturity (unchanged from v2)
CREATE OR REPLACE VIEW field_crop_maturity AS
SELECT
    fc.field_crop_id,
    fc.field_id,
    f.field_name,
    f.farm_id,
    fm.farm_name,
    fm.farmer_id,
    c.crop_id,
    c.crop_name,
    fc.planting_date,
    c.days_to_maturity,
    fc.planting_date + c.days_to_maturity                  AS expected_maturity_date,
    CURRENT_DATE - (fc.planting_date + c.days_to_maturity) AS days_past_maturity
FROM field_crop fc
JOIN field f  ON f.field_id = fc.field_id
JOIN farm  fm ON fm.farm_id = f.farm_id
JOIN crop  c  ON c.crop_id  = fc.crop_id
WHERE fc.is_active;

CREATE OR REPLACE VIEW crop_maturity_alert AS
SELECT *
FROM field_crop_maturity
WHERE expected_maturity_date <= CURRENT_DATE;


-- #####################################################################
-- PERMISSIONS
-- #####################################################################

-- Row-level permissions for the app role, and nothing structural
GRANT USAGE ON SCHEMA public TO system_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO system_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO system_app;

-- Tables that system_owner creates LATER (via migrations) get the same grants
-- automatically, so you won't forget to grant on every new table
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO system_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO system_app;

RESET ROLE;

COMMIT;