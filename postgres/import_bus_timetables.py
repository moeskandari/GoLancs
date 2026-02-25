#!/usr/bin/env python3
"""
Import bus departure timetables from TransXChange XML via transport.scc.lancs.ac.uk
Populates bus_journeys and bus_journey_stops tables with scheduled departure/arrival times.

Parses VehicleJourney elements to extract:
  - Journey departure times and operating days
  - Per-stop arrival/departure times calculated from timing links
  - Links journeys to existing bus_routes

Usage:
    python3 import_bus_timetables.py              # All operators
    python3 import_bus_timetables.py SCCU          # Single operator
"""

import re
import requests
import zipfile
import io
import xml.etree.ElementTree as ET
import psycopg2
import sys
import time as time_module
from datetime import date, timedelta

# Database configuration
DB_CONFIG = {
    'host': 'localhost',
    'port': 5050,
    'database': 'group1db',
    'user': 'postgres',
    'password': 'group1'
}

BASE_URL = "https://transport.scc.lancs.ac.uk"

OPERATORS = ['ARCT', 'BLAC', 'KLCO', 'SCCU', 'SCMY', 'NUTT']

PREFERRED_DATASETS = {
    'SCCU': [18047],
    'SCMY': [18508],
}

TXC_NS = {'txc': 'http://www.transxchange.org.uk/'}

# Days of week mapping - TransXChange day names to bit positions (Mon=0 .. Sun=6)
DAY_MAP = {
    'Monday': 0,
    'Tuesday': 1,
    'Wednesday': 2,
    'Thursday': 3,
    'Friday': 4,
    'Saturday': 5,
    'Sunday': 6,
    'MondayToFriday': 'MF',
    'MondayToSaturday': 'MS',
    'MondayToSunday': 'ALL',
    'Weekend': 'WE',
    'NotSaturday': 'NS',
}


def parse_duration(pt_str):
    """Parse ISO 8601 duration like PT1M30S or PT1H2M to seconds"""
    if not pt_str:
        return 0
    m = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', pt_str)
    if not m:
        return 0
    h = int(m.group(1) or 0)
    mi = int(m.group(2) or 0)
    s = int(m.group(3) or 0)
    return h * 3600 + mi * 60 + s


def time_str(seconds):
    """Convert seconds since midnight to HH:MM:SS string"""
    h = (seconds // 3600) % 24
    m = (seconds % 3600) // 60
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:02d}"


def parse_days_of_week(operating_profile, ns):
    """
    Parse OperatingProfile to extract days of week as a string like '1111100'.
    Position 0=Mon, 6=Sun. '1' = runs, '0' = doesn't run.
    """
    days = [0, 0, 0, 0, 0, 0, 0]

    if operating_profile is None:
        return '1111100'  # Default: Mon-Fri

    reg_days = operating_profile.find('txc:RegularDayType', ns)
    if reg_days is None:
        return '1111100'

    dow = reg_days.find('txc:DaysOfWeek', ns)
    if dow is None:
        # Check for HolidaysOnly etc
        hols = reg_days.find('txc:HolidaysOnly', ns)
        if hols is not None:
            return '0000000'  # Skip holiday-only services
        return '1111100'

    for child in dow:
        tag = child.tag.split('}')[-1]
        if tag == 'MondayToFriday':
            days[0:5] = [1, 1, 1, 1, 1]
        elif tag == 'MondayToSaturday':
            days[0:6] = [1, 1, 1, 1, 1, 1]
        elif tag == 'MondayToSunday':
            days = [1, 1, 1, 1, 1, 1, 1]
        elif tag == 'Weekend':
            days[5:7] = [1, 1]
        elif tag == 'NotSaturday':
            days = [1, 1, 1, 1, 1, 0, 1]
        elif tag in DAY_MAP:
            idx = DAY_MAP[tag]
            if isinstance(idx, int):
                days[idx] = 1

    return ''.join(str(d) for d in days)


def parse_date_range(operating_profile, ns):
    """Extract operating period date range if specified"""
    start_date = None
    end_date = None

    if operating_profile is None:
        return start_date, end_date

    # Check SpecialDaysOperation for validity
    special = operating_profile.find('txc:SpecialDaysOperation', ns)
    if special is not None:
        # We don't filter on special days - just note them
        pass

    return start_date, end_date


def get_db_connection():
    """Create database connection"""
    try:
        return psycopg2.connect(**DB_CONFIG)
    except Exception:
        alt = DB_CONFIG.copy()
        alt['host'] = 'postgres'
        alt['port'] = 5432
        return psycopg2.connect(**alt)


def create_tables(conn):
    """Create bus_journeys and bus_journey_stops tables if not exist"""
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS bus_journeys (
            journey_id SERIAL PRIMARY KEY,
            route_id INTEGER REFERENCES bus_routes(route_id),
            route_number TEXT NOT NULL,
            operator_code TEXT NOT NULL REFERENCES operators(operator_code),
            direction TEXT,
            departure_time TIME NOT NULL,
            days_of_week TEXT NOT NULL DEFAULT '1111100',
            valid_from DATE,
            valid_until DATE,
            journey_code TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_bus_journeys_route ON bus_journeys(route_id);
        CREATE INDEX IF NOT EXISTS idx_bus_journeys_departure ON bus_journeys(departure_time);
        CREATE INDEX IF NOT EXISTS idx_bus_journeys_operator ON bus_journeys(operator_code);
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS bus_journey_stops (
            id SERIAL PRIMARY KEY,
            journey_id INTEGER NOT NULL REFERENCES bus_journeys(journey_id) ON DELETE CASCADE,
            atco_code TEXT NOT NULL REFERENCES stops(atco_code),
            stop_sequence INTEGER NOT NULL,
            arrival_time TIME,
            departure_time TIME,
            activity TEXT DEFAULT 'pickUpAndSetDown'
        );
        CREATE INDEX IF NOT EXISTS idx_bjs_journey ON bus_journey_stops(journey_id);
        CREATE INDEX IF NOT EXISTS idx_bjs_atco ON bus_journey_stops(atco_code);
        CREATE INDEX IF NOT EXISTS idx_bjs_departure ON bus_journey_stops(departure_time);
    """)

    conn.commit()
    cur.close()


def load_db_stops(conn):
    """Load all stops from DB into a set of ATCO codes"""
    cur = conn.cursor()
    cur.execute("SELECT atco_code FROM stops")
    stops = set(row[0] for row in cur.fetchall())
    cur.close()
    return stops


def load_routes_map(conn):
    """Load existing bus_routes to link journeys to routes"""
    cur = conn.cursor()
    cur.execute("""
        SELECT route_id, route_number, operator_code, start_atco_code, end_atco_code
        FROM bus_routes
    """)
    routes = {}
    for row in cur.fetchall():
        key = (row[1], row[2])  # (route_number, operator_code)
        if key not in routes:
            routes[key] = []
        routes[key].append({
            'route_id': row[0],
            'start': row[3],
            'end': row[4]
        })
    cur.close()
    return routes


def fetch_operator_datasets(operator_code):
    """Fetch available datasets for an operator from the API"""
    url = f"{BASE_URL}/bus/times/{operator_code}"
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        results = data.get('results', [])

        if operator_code in PREFERRED_DATASETS:
            preferred_ids = PREFERRED_DATASETS[operator_code]
            preferred = [r for r in results if r['id'] in preferred_ids]
            if preferred:
                return preferred

        return results
    except Exception as e:
        print(f"    Error fetching datasets: {e}")
        return []


def download_and_extract(dataset):
    """Download a dataset and return list of (filename, xml_bytes) tuples"""
    url = dataset.get('url')
    ext = dataset.get('extension', 'xml')
    if not url:
        return []

    try:
        resp = requests.get(url, timeout=120)
        resp.raise_for_status()
    except Exception as e:
        print(f"    Download error: {e}")
        return []

    xml_files = []
    if ext == 'zip':
        try:
            with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
                for name in zf.namelist():
                    if name.lower().endswith('.xml'):
                        xml_files.append((name, zf.read(name)))
        except zipfile.BadZipFile:
            print(f"    Bad ZIP file")
    else:
        xml_files.append(('download.xml', resp.content))

    return xml_files


def parse_timetables_from_xml(xml_bytes, operator_code, db_stops):
    """
    Parse TransXChange XML and extract VehicleJourney timetables.
    Returns list of journey dicts with stop times.
    """
    journeys = []

    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return journeys

    ns = TXC_NS

    # Build StopPoint ref -> ATCO code mapping
    stop_refs = {}
    for sp in root.findall('.//txc:StopPoints/txc:AnnotatedStopPointRef', ns):
        ref = sp.find('txc:StopPointRef', ns)
        if ref is not None:
            stop_refs[ref.text] = ref.text

    for sp in root.findall('.//txc:StopPoints/txc:StopPoint', ns):
        atco = sp.find('txc:AtcoCode', ns)
        priv_code = sp.get('id') or ''
        if atco is not None:
            stop_refs[priv_code] = atco.text
            stop_refs[atco.text] = atco.text

    # Check if any stops in this file are in our region
    regional_stops = set(ref for ref in stop_refs.values() if ref in db_stops)
    if not regional_stops:
        return journeys  # Skip files with no stops in our DB

    # Build JourneyPatternSection timing data: section_id -> [links]
    sections = {}
    for jps in root.findall('.//txc:JourneyPatternSections/txc:JourneyPatternSection', ns):
        sid = jps.get('id')
        if not sid:
            continue
        links = []
        for link in jps.findall('txc:JourneyPatternTimingLink', ns):
            link_id = link.get('id')
            from_stop = link.find('txc:From/txc:StopPointRef', ns)
            to_stop = link.find('txc:To/txc:StopPointRef', ns)
            run_time = link.find('txc:RunTime', ns)
            from_wait = link.find('txc:From/txc:WaitTime', ns)
            to_wait = link.find('txc:To/txc:WaitTime', ns)
            from_activity = link.find('txc:From/txc:Activity', ns)
            to_activity = link.find('txc:To/txc:Activity', ns)

            links.append({
                'id': link_id,
                'from': stop_refs.get(from_stop.text, from_stop.text) if from_stop is not None else None,
                'to': stop_refs.get(to_stop.text, to_stop.text) if to_stop is not None else None,
                'run_seconds': parse_duration(run_time.text if run_time is not None else None),
                'from_wait': parse_duration(from_wait.text if from_wait is not None else None),
                'to_wait': parse_duration(to_wait.text if to_wait is not None else None),
                'from_activity': from_activity.text if from_activity is not None else 'pickUpAndSetDown',
                'to_activity': to_activity.text if to_activity is not None else 'pickUpAndSetDown',
            })
        sections[sid] = links

    # Build JourneyPattern -> section refs + direction
    jp_map = {}
    for jp in root.findall('.//txc:JourneyPattern', ns):
        jp_id = jp.get('id')
        sec_refs = [s.text for s in jp.findall('txc:JourneyPatternSectionRefs', ns)]
        direction = jp.find('txc:Direction', ns)
        jp_map[jp_id] = {
            'sections': sec_refs,
            'direction': direction.text if direction is not None else 'outbound'
        }

    # Get route number from Services
    route_numbers = {}
    service_operating_profile = None

    for service in root.findall('.//txc:Services/txc:Service', ns):
        svc_code = service.find('txc:ServiceCode', ns)
        svc_code_text = svc_code.text if svc_code is not None else None

        # Get service-level operating profile as default
        svc_op = service.find('txc:OperatingProfile', ns)
        if svc_op is not None:
            service_operating_profile = svc_op

        for line in service.findall('.//txc:Line', ns):
            line_id = line.get('id')
            ln = line.find('txc:LineName', ns)
            if ln is not None:
                route_numbers[line_id] = ln.text.strip()
                if svc_code_text:
                    route_numbers[svc_code_text] = ln.text.strip()

    # Fallback line name
    default_route = None
    if not route_numbers:
        ln = root.find('.//txc:LineName', ns)
        if ln is not None:
            default_route = ln.text.strip()

    # Get operating period from Service
    op_period = root.find('.//txc:Services/txc:Service/txc:OperatingPeriod', ns)
    service_valid_from = None
    service_valid_until = None
    if op_period is not None:
        sd = op_period.find('txc:StartDate', ns)
        ed = op_period.find('txc:EndDate', ns)
        if sd is not None and sd.text:
            try:
                service_valid_from = date.fromisoformat(sd.text)
            except ValueError:
                pass
        if ed is not None and ed.text:
            try:
                service_valid_until = date.fromisoformat(ed.text)
            except ValueError:
                pass

    # Parse VehicleJourneys
    vjs = root.findall('.//txc:VehicleJourneys/txc:VehicleJourney', ns)

    for vj in vjs:
        vj_code_el = vj.find('txc:VehicleJourneyCode', ns)
        dep_time_el = vj.find('txc:DepartureTime', ns)
        jp_ref_el = vj.find('txc:JourneyPatternRef', ns)
        line_ref_el = vj.find('txc:LineRef', ns)

        if dep_time_el is None or jp_ref_el is None:
            continue

        vj_code = vj_code_el.text if vj_code_el is not None else None
        dep_time_str = dep_time_el.text
        jp_ref = jp_ref_el.text

        if jp_ref not in jp_map:
            continue

        # Determine route number
        route_num = default_route
        if line_ref_el is not None and line_ref_el.text in route_numbers:
            route_num = route_numbers[line_ref_el.text]
        if not route_num:
            for k, v in route_numbers.items():
                route_num = v
                break
        if not route_num:
            continue

        # Parse operating days
        op_profile = vj.find('txc:OperatingProfile', ns)
        if op_profile is None:
            op_profile = service_operating_profile
        days_of_week = parse_days_of_week(op_profile, ns)

        # Skip holiday-only services
        if days_of_week == '0000000':
            continue

        direction = jp_map[jp_ref]['direction']

        # Collect VehicleJourney timing overrides
        vj_overrides = {}
        for vtl in vj.findall('.//txc:VehicleJourneyTimingLink', ns):
            ref = vtl.find('txc:JourneyPatternTimingLinkRef', ns)
            run = vtl.find('txc:RunTime', ns)
            if ref is not None and run is not None:
                vj_overrides[ref.text] = parse_duration(run.text)

        # Calculate stop times
        sec_refs = jp_map[jp_ref]['sections']
        h, m, s = 0, 0, 0
        try:
            parts = dep_time_str.split(':')
            h, m = int(parts[0]), int(parts[1])
            if len(parts) > 2:
                s = int(parts[2])
        except (ValueError, IndexError):
            continue

        current_time = h * 3600 + m * 60 + s
        stop_times = []
        stop_num = 0

        for sec_id in sec_refs:
            links = sections.get(sec_id, [])
            for i, link in enumerate(links):
                from_atco = link['from']
                to_atco = link['to']

                # First stop: departure at current_time
                if stop_num == 0 and from_atco:
                    if from_atco in db_stops:
                        stop_times.append({
                            'atco_code': from_atco,
                            'sequence': stop_num,
                            'arrival': None,
                            'departure': time_str(current_time),
                            'activity': link['from_activity'],
                        })
                    stop_num += 1

                # Apply run time (with override if available)
                run_secs = vj_overrides.get(link['id'], link['run_seconds'])
                current_time += link['from_wait'] + run_secs

                # Arrival at 'to' stop
                if to_atco and to_atco in db_stops:
                    arr_time = time_str(current_time)
                    # Departure from this stop = arrival + dwell/wait
                    dep_at_stop = time_str(current_time + link['to_wait'])
                    stop_times.append({
                        'atco_code': to_atco,
                        'sequence': stop_num,
                        'arrival': arr_time,
                        'departure': dep_at_stop if link['to_wait'] > 0 else arr_time,
                        'activity': link['to_activity'],
                    })

                # Add dwell time
                current_time += link['to_wait']
                stop_num += 1

        # Only keep journeys with at least 2 stops in our region
        if len(stop_times) >= 2:
            journeys.append({
                'journey_code': vj_code,
                'route_number': route_num,
                'direction': direction,
                'departure_time': dep_time_str,
                'days_of_week': days_of_week,
                'valid_from': service_valid_from,
                'valid_until': service_valid_until,
                'stop_times': stop_times,
            })

    return journeys


def match_route(journey, routes_map, operator_code):
    """Try to match a journey to an existing bus_route by route number and stop overlap"""
    route_num = journey['route_number']
    key = (route_num, operator_code)
    candidates = routes_map.get(key, [])

    if not candidates:
        return None

    # Find the route whose start/end best matches journey stops
    journey_stops = [s['atco_code'] for s in journey['stop_times']]
    first_stop = journey_stops[0]
    last_stop = journey_stops[-1]

    best_route = None
    best_score = -1
    for route in candidates:
        score = 0
        if route['start'] == first_stop:
            score += 2
        elif route['start'] in journey_stops:
            score += 1
        if route['end'] == last_stop:
            score += 2
        elif route['end'] in journey_stops:
            score += 1
        if score > best_score:
            best_score = score
            best_route = route['route_id']

    return best_route


def insert_journeys(conn, operator_code, journeys, routes_map):
    """Insert parsed journeys into bus_journeys and bus_journey_stops"""
    cur = conn.cursor()
    inserted = 0
    skipped = 0

    for journey in journeys:
        route_id = match_route(journey, routes_map, operator_code)

        try:
            cur.execute("""
                INSERT INTO bus_journeys
                    (route_id, route_number, operator_code, direction, departure_time,
                     days_of_week, valid_from, valid_until, journey_code)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING journey_id
            """, (
                route_id,
                journey['route_number'],
                operator_code,
                journey['direction'],
                journey['departure_time'],
                journey['days_of_week'],
                journey['valid_from'],
                journey['valid_until'],
                journey['journey_code'],
            ))
            journey_id = cur.fetchone()[0]

            for stop in journey['stop_times']:
                cur.execute("""
                    INSERT INTO bus_journey_stops
                        (journey_id, atco_code, stop_sequence, arrival_time, departure_time, activity)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (
                    journey_id,
                    stop['atco_code'],
                    stop['sequence'],
                    stop['arrival'],
                    stop['departure'],
                    stop['activity'],
                ))

            conn.commit()
            inserted += 1

        except psycopg2.IntegrityError as e:
            conn.rollback()
            skipped += 1
        except Exception as e:
            conn.rollback()
            skipped += 1
            if inserted < 3:
                print(f"      Error inserting journey: {e}")

    cur.close()
    return inserted, skipped


def main():
    filter_op = None
    for arg in sys.argv[1:]:
        up = arg.upper()
        if up in OPERATORS:
            filter_op = up

    operators = [filter_op] if filter_op else OPERATORS

    print("=" * 60)
    print("  Bus Timetable Importer")
    print("  Lancaster • Preston • Blackpool • Fylde Coast")
    print("=" * 60)
    print(f"  Operators: {', '.join(operators)}")
    print()

    conn = get_db_connection()

    # Create tables
    create_tables(conn)
    print("  ✓ Tables ready (bus_journeys, bus_journey_stops)")

    # Load reference data
    db_stops = load_db_stops(conn)
    routes_map = load_routes_map(conn)
    print(f"  ✓ Loaded {len(db_stops)} stops, {sum(len(v) for v in routes_map.values())} route variants")
    print()

    # Clear existing timetable data for clean import
    cur = conn.cursor()
    cur.execute("DELETE FROM bus_journey_stops")
    cur.execute("DELETE FROM bus_journeys")
    conn.commit()
    cur.close()
    print("  Cleared existing timetable data\n")

    total_journeys = 0
    total_stops = 0
    total_skipped = 0

    for op in operators:
        print(f"━━━ {op} ━━━")
        datasets = fetch_operator_datasets(op)
        print(f"  {len(datasets)} dataset(s)")

        op_journeys = 0
        op_stops = 0

        for ds in datasets:
            ds_id = ds.get('id', '?')
            desc = ds.get('description', '')[:50]
            print(f"  Dataset {ds_id}: ({desc})")

            xml_files = download_and_extract(ds)
            print(f"    Downloaded {len(xml_files)} XML file(s)")

            ds_journeys = 0
            ds_stops = 0
            files_with_data = 0

            for fname, xml_bytes in xml_files:
                journeys = parse_timetables_from_xml(xml_bytes, op, db_stops)

                if journeys:
                    files_with_data += 1
                    inserted, skipped = insert_journeys(conn, op, journeys, routes_map)
                    ds_journeys += inserted
                    total_skipped += skipped

                    for j in journeys:
                        if inserted > 0:
                            ds_stops += len(j['stop_times'])

            op_journeys += ds_journeys
            op_stops += ds_stops
            print(f"    → {files_with_data} files with regional data")
            print(f"    → {ds_journeys} journeys imported, {ds_stops} stop-times")

            time_module.sleep(1)  # Rate limiting

        total_journeys += op_journeys
        total_stops += op_stops
        print(f"  Subtotal: {op_journeys} journeys, {op_stops} stop-times\n")

    # Summary
    print("=" * 60)
    print(f"  IMPORT COMPLETE")
    print(f"  Journeys imported: {total_journeys}")
    print(f"  Stop-times:        {total_stops}")
    print(f"  Skipped:           {total_skipped}")
    print()

    # Stats
    cur = conn.cursor()

    # By operator
    cur.execute("""
        SELECT o.name, COUNT(bj.journey_id)
        FROM bus_journeys bj
        JOIN operators o ON bj.operator_code = o.operator_code
        GROUP BY o.name
        ORDER BY COUNT(*) DESC
    """)
    rows = cur.fetchall()
    if rows:
        print("  Journeys by operator:")
        for name, count in rows:
            print(f"    {name:<40} {count:>5}")
        print()

    # By route
    cur.execute("""
        SELECT bj.route_number, bj.operator_code, COUNT(*) as journeys,
               MIN(bj.departure_time) as first_dep,
               MAX(bj.departure_time) as last_dep
        FROM bus_journeys bj
        GROUP BY bj.route_number, bj.operator_code
        ORDER BY COUNT(*) DESC
        LIMIT 15
    """)
    rows = cur.fetchall()
    if rows:
        print("  Top routes by number of journeys:")
        print(f"  {'Route':<8} {'Op':<6} {'Journeys':>8} {'First':>10} {'Last':>10}")
        print(f"  {'-'*48}")
        for route, op, count, first, last in rows:
            print(f"  {route:<8} {op:<6} {count:>8} {str(first):>10} {str(last):>10}")
        print()

    # Departures from key stops
    print("  Sample departures from key locations:")
    for place, pattern in [
        ('Lancaster Bus Station', '%Lancaster Bus%'),
        ('Preston Bus Station', '%Preston Bus%'),
        ('Morecambe Bus Station', '%Morecambe Bus%'),
    ]:
        cur.execute("""
            SELECT COUNT(DISTINCT bjs.journey_id)
            FROM bus_journey_stops bjs
            JOIN stops s ON bjs.atco_code = s.atco_code
            WHERE s.common_name ILIKE %s
        """, (pattern,))
        count = cur.fetchone()[0]

        cur.execute("""
            SELECT bjs.departure_time, bj.route_number, bj.operator_code
            FROM bus_journey_stops bjs
            JOIN bus_journeys bj ON bjs.journey_id = bj.journey_id
            JOIN stops s ON bjs.atco_code = s.atco_code
            WHERE s.common_name ILIKE %s
            AND bjs.departure_time IS NOT NULL
            AND bj.days_of_week LIKE '%%1%%'
            ORDER BY bjs.departure_time
            LIMIT 3
        """, (pattern,))
        sample = cur.fetchall()
        sample_str = ', '.join(f"{str(t)[:5]} ({r})" for t, r, o in sample) if sample else 'none'
        print(f"    {place:<30} {count:>4} journeys  First: {sample_str}")

    cur.close()
    conn.close()
    print(f"\n  ✓ Done!")


if __name__ == '__main__':
    main()
