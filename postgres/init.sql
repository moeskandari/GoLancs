-- Simple table creation instead of using the full backup
CREATE TABLE IF NOT EXISTS stops (
  atco_code TEXT PRIMARY KEY,
  common_name TEXT,
  coordinates POINT,
  stop_type TEXT
);

CREATE TABLE IF NOT EXISTS bus_services (
  service_id SERIAL PRIMARY KEY,
  service_code TEXT UNIQUE,
  operator TEXT
);

CREATE TABLE IF NOT EXISTS bus_schedule_points (
  id SERIAL PRIMARY KEY,
  service_id INTEGER REFERENCES bus_services(service_id) ON DELETE CASCADE,
  atco_code TEXT REFERENCES stops(atco_code),
  arrival_time TIME,
  departure_time TIME,
  sequence_order INTEGER
);

-- Restore data from the original backup if it exists
-- This will need to be done separately with the proper psql import
