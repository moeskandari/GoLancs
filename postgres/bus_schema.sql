-- Ensure bus routing tables exist and ATCO codes support alphanumeric values

ALTER TABLE IF EXISTS national_rail
  DROP CONSTRAINT IF EXISTS fk_atco;

ALTER TABLE IF EXISTS stops
  ALTER COLUMN atco_code TYPE text USING atco_code::text;

ALTER TABLE IF EXISTS national_rail
  ALTER COLUMN atco_code TYPE text USING atco_code::text;

CREATE TABLE IF NOT EXISTS bus_services (
  service_id SERIAL PRIMARY KEY,
  operator_code TEXT REFERENCES operators(operator_code),
  route_number TEXT,
  direction TEXT,
  start_date DATE,
  end_date DATE,
  days_of_operation TEXT
);

CREATE TABLE IF NOT EXISTS bus_schedule_points (
  id SERIAL PRIMARY KEY,
  service_id INTEGER REFERENCES bus_services(service_id) ON DELETE CASCADE,
  atco_code TEXT REFERENCES stops(atco_code),
  arrival_time TIME,
  departure_time TIME,
  sequence_order INTEGER
);

ALTER TABLE IF EXISTS bus_schedule_points
  DROP CONSTRAINT IF EXISTS bus_schedule_points_atco_code_fkey;

ALTER TABLE IF EXISTS bus_schedule_points
  ADD CONSTRAINT bus_schedule_points_atco_code_fkey
  FOREIGN KEY (atco_code) REFERENCES stops(atco_code);

ALTER TABLE IF EXISTS national_rail
  ADD CONSTRAINT fk_atco
  FOREIGN KEY (atco_code) REFERENCES stops(atco_code);
