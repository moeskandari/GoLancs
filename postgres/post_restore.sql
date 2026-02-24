-- Post-restore schema updates to support alphanumeric ATCO codes

-- Drop foreign key constraints first
ALTER TABLE IF EXISTS national_rail DROP CONSTRAINT IF EXISTS fk_atco;
ALTER TABLE IF EXISTS bus_schedule_points DROP CONSTRAINT IF EXISTS bus_schedule_points_atco_code_fkey;
ALTER TABLE IF EXISTS schedule_points DROP CONSTRAINT IF EXISTS fk_atco_stops;

-- Convert atco_code to text in all relevant tables
ALTER TABLE stops ALTER COLUMN atco_code TYPE text;
ALTER TABLE national_rail ALTER COLUMN atco_code TYPE text;
ALTER TABLE IF EXISTS bus_schedule_points ALTER COLUMN atco_code TYPE text;
ALTER TABLE IF EXISTS schedule_points ALTER COLUMN atco_code TYPE text;

-- Recreate foreign key constraints
ALTER TABLE national_rail
  ADD CONSTRAINT fk_atco FOREIGN KEY (atco_code) REFERENCES stops(atco_code);

ALTER TABLE IF EXISTS bus_schedule_points
  ADD CONSTRAINT bus_schedule_points_atco_code_fkey
  FOREIGN KEY (atco_code) REFERENCES stops(atco_code);

ALTER TABLE IF EXISTS schedule_points
  ADD CONSTRAINT fk_atco_stops FOREIGN KEY (atco_code) REFERENCES stops(atco_code);

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