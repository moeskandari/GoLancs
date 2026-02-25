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