#!/usr/bin/env python3
"""
Import bus route definitions from TransXChange XML via transport.scc.lancs.ac.uk
Populates bus_routes and route_stops tables for multi-leg journey planning.

Covers: Lancaster, Preston, Blackpool, Fylde coast, Morecambe, Heysham, Carnforth

Usage:
    python3 import_bus_routes.py              # All operators
    python3 import_bus_routes.py ARCT         # Single operator
"""

import json
import requests
import zipfile
import io
import xml.etree.ElementTree as ET
import psycopg2
import sys
import time
from math import radians, sin, cos, sqrt, atan2

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

# Preferred dataset IDs per operator (most relevant for our region)
# SCCU 18047 = Cumbria & North Lancashire (Lancaster, Morecambe, Carnforth)
# SCMY 18046 = Merseyside & South Lancashire (Preston area)
PREFERRED_DATASETS = {
    'SCCU': [18047],
    'SCMY': [18508],
}

TXC_NS = {'txc': 'http://www.transxchange.org.uk/'}


def haversine_distance(lon1, lat1, lon2, lat2):
    """Calculate distance between two coordinates in meters"""
    R = 6371000
    lat1_r, lat2_r = radians(lat1), radians(lat2)
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat/2)**2 + cos(lat1_r) * cos(lat2_r) * sin(dlon/2)**2
    return R * 2 * atan2(sqrt(a), sqrt(1-a))


def estimate_travel_time(lon1, lat1, lon2, lat2):
    """Estimate travel time in seconds (avg 20 km/h bus speed)"""
    dist = haversine_distance(lon1, lat1, lon2, lat2)
    speed = 20 * 1000 / 3600  # 20 km/h in m/s
    return max(30, int(dist / speed))


def get_db_connection():
    """Create database connection"""
    try:
        return psycopg2.connect(**DB_CONFIG)
    except Exception:
        alt = DB_CONFIG.copy()
        alt['host'] = 'postgres'
        alt['port'] = 5432
        return psycopg2.connect(**alt)


def load_stops(conn):
    """Load all stops from DB into dict keyed by atco_code"""
    cur = conn.cursor()
    cur.execute("SELECT atco_code, common_name, coordinates[0] as lon, coordinates[1] as lat FROM stops WHERE coordinates IS NOT NULL")
    stops = {}
    for code, name, lon, lat in cur.fetchall():
        stops[code] = {'name': name, 'lon': float(lon), 'lat': float(lat)}
    cur.close()
    return stops


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
        resp = requests.get(url, timeout=60)
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


def parse_routes_from_xml(xml_bytes, operator_code):
    """
    Parse TransXChange XML and extract route definitions.
    Returns dict: { (route_number, direction): [list of atco_code strings] }
    """
    routes = {}

    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        return routes

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

    # Build JourneyPatternSection map: section_id -> [(from, to)]
    sections = {}
    for jps in root.findall('.//txc:JourneyPatternSections/txc:JourneyPatternSection', ns):
        sid = jps.get('id')
        if not sid:
            continue
        links = []
        for link in jps.findall('txc:JourneyPatternTimingLink', ns):
            from_el = link.find('txc:From/txc:StopPointRef', ns)
            to_el = link.find('txc:To/txc:StopPointRef', ns)
            fr = from_el.text if from_el is not None else None
            to = to_el.text if to_el is not None else None
            if fr and to:
                links.append((fr, to))
        sections[sid] = links

    # Get route number from Services
    route_numbers = {}
    for service in root.findall('.//txc:Services/txc:Service', ns):
        svc_code = service.find('txc:ServiceCode', ns)
        svc_code_text = svc_code.text if svc_code is not None else None

        line_names = service.findall('.//txc:Line/txc:LineName', ns)
        if not line_names:
            line_names = service.findall('.//txc:LineName', ns)

        if line_names and svc_code_text:
            route_numbers[svc_code_text] = line_names[0].text.strip()

        # Also map by line id
        for line in service.findall('.//txc:Line', ns):
            line_id = line.get('id')
            ln = line.find('txc:LineName', ns)
            if line_id and ln is not None:
                route_numbers[line_id] = ln.text.strip()

    # If no service-level mapping, try to get any LineName
    default_route = None
    if not route_numbers:
        ln = root.find('.//txc:LineName', ns)
        if ln is not None:
            default_route = ln.text.strip()

    # Parse JourneyPatterns
    for jp in root.findall('.//txc:JourneyPattern', ns):
        direction_el = jp.find('txc:Direction', ns)
        direction = direction_el.text if direction_el is not None else 'outbound'

        # Determine route number for this pattern
        route_num = default_route
        line_ref = jp.find('txc:LineRef', ns)
        if line_ref is not None and line_ref.text in route_numbers:
            route_num = route_numbers[line_ref.text]

        if not route_num:
            # Try first available
            for k, v in route_numbers.items():
                route_num = v
                break

        if not route_num:
            continue

        # Build stop sequence from referenced sections
        section_refs = jp.findall('txc:JourneyPatternSectionRefs', ns)
        stop_sequence = []
        for sec_ref in section_refs:
            sec_id = sec_ref.text
            if sec_id and sec_id in sections:
                for from_ref, to_ref in sections[sec_id]:
                    resolved_from = stop_refs.get(from_ref, from_ref)
                    resolved_to = stop_refs.get(to_ref, to_ref)
                    if resolved_from and resolved_from not in stop_sequence:
                        stop_sequence.append(resolved_from)
                    if resolved_to and resolved_to not in stop_sequence:
                        stop_sequence.append(resolved_to)

        if len(stop_sequence) >= 2:
            key = (route_num, direction)
            # Keep the longest variant of each route
            if key not in routes or len(stop_sequence) > len(routes[key]):
                routes[key] = stop_sequence

    return routes


def insert_routes(conn, operator_code, routes, stops_dict):
    """Insert parsed routes into bus_routes and route_stops tables"""
    cur = conn.cursor()
    inserted = 0
    skipped = 0

    for (route_number, direction), stop_codes in routes.items():
        valid_stops = [s for s in stop_codes if s in stops_dict]

        if len(valid_stops) < 2:
            skipped += 1
            continue

        start_atco = valid_stops[0]
        end_atco = valid_stops[-1]

        # Deduplicate
        cur.execute(
            "SELECT route_id FROM bus_routes WHERE route_number = %s AND operator_code = %s AND start_atco_code = %s AND end_atco_code = %s",
            (route_number, operator_code, start_atco, end_atco)
        )
        if cur.fetchone():
            skipped += 1
            continue

        try:
            cur.execute(
                "INSERT INTO bus_routes (route_number, operator_code, start_atco_code, end_atco_code) "
                "VALUES (%s, %s, %s, %s) RETURNING route_id",
                (route_number, operator_code, start_atco, end_atco)
            )
            route_id = cur.fetchone()[0]

            for seq, atco in enumerate(valid_stops):
                travel_time = None
                if seq < len(valid_stops) - 1:
                    next_atco = valid_stops[seq + 1]
                    c = stops_dict[atco]
                    n = stops_dict[next_atco]
                    travel_time = estimate_travel_time(c['lon'], c['lat'], n['lon'], n['lat'])

                cur.execute(
                    "INSERT INTO route_stops (route_id, atco_code, stop_sequence, travel_time_to_next) "
                    "VALUES (%s, %s, %s, %s)",
                    (route_id, atco, seq, travel_time)
                )

            conn.commit()
            inserted += 1

        except psycopg2.IntegrityError:
            conn.rollback()
            skipped += 1
        except Exception as e:
            conn.rollback()
            print(f"      Error inserting route {route_number}: {e}")
            skipped += 1

    cur.close()
    return inserted, skipped


def main():
    filter_op = None
    for arg in sys.argv[1:]:
        up = arg.upper()
        if up in OPERATORS:
            filter_op = up

    operators = [filter_op] if filter_op else OPERATORS

    print("=" * 55)
    print("  Bus Route Importer")
    print("  Lancaster • Preston • Blackpool • Coast")
    print("=" * 55)
    print(f"  Operators: {', '.join(operators)}")
    print()

    conn = get_db_connection()
    stops_dict = load_stops(conn)
    print(f"  Loaded {len(stops_dict)} stops from database\n")

    # Clear existing route data for clean import
    cur = conn.cursor()
    cur.execute("DELETE FROM route_stops")
    cur.execute("DELETE FROM bus_routes")
    conn.commit()
    cur.close()
    print("  Cleared existing route data\n")

    total_routes = 0
    total_skipped = 0

    for op in operators:
        print(f"━━━ {op} ━━━")
        datasets = fetch_operator_datasets(op)
        print(f"  {len(datasets)} dataset(s)")

        for ds in datasets:
            ds_id = ds.get('id', '?')
            ds_lines = ds.get('lines', [])
            desc = ds.get('description', '')[:50]
            print(f"  Dataset {ds_id}: {len(ds_lines)} lines ({desc})")

            xml_files = download_and_extract(ds)
            print(f"    Downloaded {len(xml_files)} XML file(s)")

            ds_routes = 0
            for fname, xml_bytes in xml_files:
                routes = parse_routes_from_xml(xml_bytes, op)
                if routes:
                    inserted, skipped = insert_routes(conn, op, routes, stops_dict)
                    ds_routes += inserted
                    total_skipped += skipped

            total_routes += ds_routes
            print(f"    → Imported {ds_routes} routes")

            time.sleep(1)  # Rate limiting

        print()

    # Summary
    print("=" * 55)
    print(f"  IMPORT COMPLETE")
    print(f"  Routes imported: {total_routes}")
    print(f"  Skipped:         {total_skipped}")
    print()

    # Top routes
    cur = conn.cursor()
    cur.execute("""
        SELECT br.route_number, br.operator_code,
               s1.common_name, s2.common_name,
               COUNT(rs.stop_id) as num_stops
        FROM bus_routes br
        JOIN stops s1 ON br.start_atco_code = s1.atco_code
        JOIN stops s2 ON br.end_atco_code = s2.atco_code
        LEFT JOIN route_stops rs ON br.route_id = rs.route_id
        GROUP BY br.route_number, br.operator_code, s1.common_name, s2.common_name
        ORDER BY num_stops DESC
        LIMIT 15
    """)
    rows = cur.fetchall()
    if rows:
        print(f"  Top routes by stops:")
        print(f"  {'Route':<8} {'Op':<6} {'From':<25} {'To':<25} {'Stops'}")
        print(f"  {'-'*70}")
        for route, op, start, end, stops in rows:
            print(f"  {route:<8} {op:<6} {start[:24]:<25} {end[:24]:<25} {stops}")
    cur.close()

    # Coverage check
    print()
    print("  Coverage for key locations:")
    cur = conn.cursor()
    for place in ['Lancaster', 'Morecambe', 'Heysham', 'Preston', 'Blackpool', 'Fleetwood', 'Carnforth', 'Poulton']:
        cur.execute("""
            SELECT COUNT(DISTINCT br.route_id)
            FROM bus_routes br
            JOIN route_stops rs ON br.route_id = rs.route_id
            JOIN stops s ON rs.atco_code = s.atco_code
            WHERE s.common_name ILIKE %s
        """, (f'%{place}%',))
        count = cur.fetchone()[0]
        status = "✓" if count > 0 else "✗"
        print(f"    {status} {place:<15} → {count} route(s)")
    cur.close()

    conn.close()
    print(f"\n  ✓ Done!")


if __name__ == '__main__':
    main()
