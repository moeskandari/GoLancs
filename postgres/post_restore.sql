-- Post-restore schema updates to support alphanumeric ATCO codes

-- Drop foreign key constraints first
ALTER TABLE IF EXISTS national_rail DROP CONSTRAINT IF EXISTS fk_atco;
ALTER TABLE IF EXISTS bus_schedule_points DROP CONSTRAINT IF EXISTS bus_schedule_points_atco_code_fkey;

-- Convert atco_code to text in all relevant tables
ALTER TABLE stops ALTER COLUMN atco_code TYPE text;
ALTER TABLE national_rail ALTER COLUMN atco_code TYPE text;

-- Only alter tables/columns that actually exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bus_schedule_points' AND column_name = 'atco_code'
  ) THEN
    EXECUTE 'ALTER TABLE bus_schedule_points ALTER COLUMN atco_code TYPE text';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'schedule_points' AND column_name = 'atco_code'
  ) THEN
    EXECUTE 'ALTER TABLE schedule_points DROP CONSTRAINT IF EXISTS fk_atco_stops';
    EXECUTE 'ALTER TABLE schedule_points ALTER COLUMN atco_code TYPE text';
  END IF;
END $$;

-- Recreate foreign key constraints
ALTER TABLE national_rail
  ADD CONSTRAINT fk_atco FOREIGN KEY (atco_code) REFERENCES stops(atco_code);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bus_schedule_points' AND column_name = 'atco_code'
  ) THEN
    EXECUTE 'ALTER TABLE bus_schedule_points ADD CONSTRAINT bus_schedule_points_atco_code_fkey FOREIGN KEY (atco_code) REFERENCES stops(atco_code)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'schedule_points' AND column_name = 'atco_code'
  ) THEN
    EXECUTE 'ALTER TABLE schedule_points ADD CONSTRAINT fk_atco_stops FOREIGN KEY (atco_code) REFERENCES stops(atco_code)';
  END IF;
END $$;

-- Insert major transit hubs (StopAreas)
INSERT INTO stops (atco_code, common_name, coordinates, stop_type)
VALUES ('250GLANBS', 'Lancaster Bus Station', point(-2.800817383, 54.050513512), 'GBCS')
ON CONFLICT (atco_code) DO UPDATE
SET common_name = EXCLUDED.common_name,
    coordinates = EXCLUDED.coordinates,
    stop_type = EXCLUDED.stop_type;

-- Insert/fix rail station stops with accurate OSM coordinates
-- These stations had no stops entries or had inaccurate coordinates
INSERT INTO stops (atco_code, common_name, coordinates) VALUES
  ('9100ANSDELL', 'Ansdell and Fairhaven Rail Station', POINT(-2.993513, 53.741637)),
  ('9100LYTHAM',  'Lytham Rail Station',                POINT(-2.9641884, 53.7393224)),
  ('9100KIRKHAM', 'Kirkham and Wesham Rail Station',     POINT(-2.8833796, 53.7869046)),
  ('9100LAYTON',  'Layton Rail Station',                 POINT(-3.0299186, 53.8353457)),
  ('9100LEYLAND', 'Leyland Rail Station',                POINT(-2.686555, 53.6985644)),
  ('9100ORMSKRK', 'Ormskirk Rail Station',               POINT(-2.8809051, 53.5695845)),
  ('9100PARBOLD', 'Parbold Rail Station',                POINT(-2.7711373, 53.5908551)),
  ('9100SALWICK', 'Salwick Rail Station',                POINT(-2.8182384, 53.7817543)),
  ('9100SQUIRES', 'Squires Gate Rail Station',           POINT(-3.0501715, 53.7769901)),
  ('9100EUXT',    'Euxton Balshaw Lane Rail Station',    POINT(-2.6716808, 53.6598241)),
  ('9100SOUTHPT', 'Southport Rail Station',              POINT(-3.0028279, 53.6468651))
ON CONFLICT (atco_code) DO UPDATE
SET common_name = EXCLUDED.common_name,
    coordinates = EXCLUDED.coordinates;

-- Fix coordinates for pre-existing rail stations (imported with inaccurate data)
UPDATE stops SET coordinates = POINT(-2.7071573, 53.7552898) WHERE atco_code = '9100PRST';
UPDATE stops SET coordinates = POINT(-2.8349663, 54.0746566) WHERE atco_code = '9100BARELA';
UPDATE stops SET coordinates = POINT(-3.048373, 53.8229372)  WHERE atco_code = '9100BLCKPLN';
UPDATE stops SET coordinates = POINT(-3.0538832, 53.787882)  WHERE atco_code = '9100BLCKPB';
UPDATE stops SET coordinates = POINT(-3.04882, 53.7984415)   WHERE atco_code = '9100BLCKS';
UPDATE stops SET coordinates = POINT(-2.8685482, 54.0703282) WHERE atco_code = '9100MORCAME';
UPDATE stops SET coordinates = POINT(-2.9896795, 53.8482922) WHERE atco_code = '9100PLTNLFY';

-- Ensure national_rail mappings exist for all stations above
INSERT INTO national_rail (tiploc_code, crs_code, atco_code) VALUES
  ('ANSDELL',  'AFV', '9100ANSDELL'),
  ('LYTHAM',   'LTM', '9100LYTHAM'),
  ('KIRKHAM',  'KKM', '9100KIRKHAM'),
  ('LAYTON',   'LAY', '9100LAYTON'),
  ('LEYLAND',  'LEY', '9100LEYLAND'),
  ('ORMSKRK',  'OMS', '9100ORMSKRK'),
  ('PARBOLD',  'PBL', '9100PARBOLD'),
  ('SALWICK',  'SAL', '9100SALWICK'),
  ('SQUIRES',  'SQU', '9100SQUIRES'),
  ('EUXT',     'EBA', '9100EUXT'),
  ('SOUTHPT',  'SOP', '9100SOUTHPT')
ON CONFLICT (tiploc_code) DO UPDATE
SET crs_code = EXCLUDED.crs_code, atco_code = EXCLUDED.atco_code;
-- Create new tables for route planning and historical tracking
CREATE TABLE IF NOT EXISTS public.bus_routes (
    route_id serial NOT NULL PRIMARY KEY,
    route_number text NOT NULL,
    operator_code text NOT NULL REFERENCES operators(operator_code),
    start_atco_code text NOT NULL REFERENCES stops(atco_code),
    end_atco_code text NOT NULL REFERENCES stops(atco_code)
);

CREATE TABLE IF NOT EXISTS public.route_stops (
    stop_id serial NOT NULL PRIMARY KEY,
    route_id integer NOT NULL REFERENCES bus_routes(route_id),
    atco_code text NOT NULL REFERENCES stops(atco_code),
    stop_sequence integer NOT NULL,
    travel_time_to_next integer
);
CREATE INDEX IF NOT EXISTS idx_route_stops_route ON public.route_stops(route_id);

CREATE TABLE IF NOT EXISTS public.journey_tracking (
    tracking_id bigserial NOT NULL PRIMARY KEY,
    operator_code text REFERENCES operators(operator_code),
    atco_code text REFERENCES stops(atco_code),
    recorded_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    vehicle_id text,
    delay_minutes integer DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_journey_tracking_time ON public.journey_tracking(recorded_time DESC);

CREATE TABLE IF NOT EXISTS public.planned_routes (
    route_plan_id bigserial NOT NULL PRIMARY KEY,
    start_atco_code text NOT NULL REFERENCES stops(atco_code),
    end_atco_code text NOT NULL REFERENCES stops(atco_code),
    departure_time timestamp without time zone,
    total_duration integer,
    num_legs integer,
    route_details jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_planned_routes_locations ON public.planned_routes(start_atco_code, end_atco_code);

-- Bus timetable tables
CREATE TABLE IF NOT EXISTS public.bus_journeys (
    journey_id serial NOT NULL PRIMARY KEY,
    route_id integer REFERENCES bus_routes(route_id),
    route_number text NOT NULL,
    operator_code text NOT NULL REFERENCES operators(operator_code),
    direction text,
    departure_time time NOT NULL,
    days_of_week text NOT NULL DEFAULT '1111100',
    valid_from date,
    valid_until date,
    journey_code text
);
CREATE INDEX IF NOT EXISTS idx_bus_journeys_route ON public.bus_journeys(route_id);
CREATE INDEX IF NOT EXISTS idx_bus_journeys_departure ON public.bus_journeys(departure_time);
CREATE INDEX IF NOT EXISTS idx_bus_journeys_operator ON public.bus_journeys(operator_code);

CREATE TABLE IF NOT EXISTS public.bus_journey_stops (
    id serial NOT NULL PRIMARY KEY,
    journey_id integer NOT NULL REFERENCES bus_journeys(journey_id) ON DELETE CASCADE,
    atco_code text NOT NULL REFERENCES stops(atco_code),
    stop_sequence integer NOT NULL,
    arrival_time time,
    departure_time time,
    activity text DEFAULT 'pickUpAndSetDown'
);
CREATE INDEX IF NOT EXISTS idx_bjs_journey ON public.bus_journey_stops(journey_id);
CREATE INDEX IF NOT EXISTS idx_bjs_atco ON public.bus_journey_stops(atco_code);
CREATE INDEX IF NOT EXISTS idx_bjs_departure ON public.bus_journey_stops(departure_time);

-- ── Performance indexes (always run, even if tables pre-exist from backup) ──

-- Composite indexes for bus transfer and direct bus query patterns
CREATE INDEX IF NOT EXISTS idx_bjs_atco_journey_seq ON public.bus_journey_stops(atco_code, journey_id, stop_sequence);
CREATE INDEX IF NOT EXISTS idx_bjs_journey_seq ON public.bus_journey_stops(journey_id, stop_sequence);

-- Bus journeys indexes (may already exist from CREATE TABLE above, IF NOT EXISTS is safe)
CREATE INDEX IF NOT EXISTS idx_bus_journeys_route ON public.bus_journeys(route_id);
CREATE INDEX IF NOT EXISTS idx_bus_journeys_departure ON public.bus_journeys(departure_time);
CREATE INDEX IF NOT EXISTS idx_bus_journeys_operator ON public.bus_journeys(operator_code);

-- Stop code prefix index for expandStopCode lookups
CREATE INDEX IF NOT EXISTS idx_stops_atco_prefix ON public.stops(substring(atco_code from 1 for 7));

-- Rail schedule indexes (schedule_points can have 20k+ rows with multi-way self-joins)
CREATE INDEX IF NOT EXISTS idx_sp_tiploc ON public.schedule_points(tiploc_code);
CREATE INDEX IF NOT EXISTS idx_sp_train_uid ON public.schedule_points(train_uid);
CREATE INDEX IF NOT EXISTS idx_sp_departure ON public.schedule_points(departure_time);
CREATE INDEX IF NOT EXISTS idx_sp_train_seq ON public.schedule_points(train_uid, sequence_order);
CREATE INDEX IF NOT EXISTS idx_sp_tiploc_train ON public.schedule_points(tiploc_code, train_uid);

-- National rail lookup indexes
CREATE INDEX IF NOT EXISTS idx_nr_atco ON public.national_rail(atco_code);
CREATE INDEX IF NOT EXISTS idx_nr_crs ON public.national_rail(crs_code);

-- Run ANALYZE so the query planner uses the new indexes effectively
ANALYZE public.bus_journey_stops;
ANALYZE public.bus_journeys;
ANALYZE public.stops;
ANALYZE public.schedule_points;
ANALYZE public.national_rail;