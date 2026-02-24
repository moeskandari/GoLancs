#!/usr/bin/env python3
"""
Import rail data from transport.scc.lancs.ac.uk into the group1db database.

Sources:
  /rail/corpus    - CORPUS: TIPLOC/STANOX/CRS code mappings (gzipped JSON)
  /rail/schedule  - Daily timetable (gzipped NDJSON, ~122MB)
  /rail/facilities/XXX - Station facility info (JSON)
  /rail/departures/XXX - Live departures (XML)
  /rail/delay-codes.json - Delay attribution codes

This script:
1. Downloads CORPUS data and populates national_rail table with regional stations
2. Inserts rail station stops into stops table (if not already present)
3. Downloads the daily schedule and extracts trains serving our region
4. Populates rail_schedule and schedule_points tables
"""

import json
import gzip
import urllib.request
import io
import sys
import psycopg2
from datetime import datetime, date

# Database connection
DB_CONFIG = {
    'host': 'localhost',
    'port': 5050,
    'dbname': 'group1db',
    'user': 'postgres',
    'password': 'group1'
}

BASE_URL = "https://transport.scc.lancs.ac.uk"

# Our region's rail stations with their CRS codes
# These are the stations in the Lancaster-Preston-Blackpool-Coast region
REGION_STATIONS = {
    'LAN': 'Lancaster',
    'PRE': 'Preston',
    'BPN': 'Blackpool North',
    'BPS': 'Blackpool South',
    'BPB': 'Blackpool Pleasure Beach',
    'PFY': 'Poulton-le-Fylde',
    'MCM': 'Morecambe',
    'BAR': 'Bare Lane',
    'HHB': 'Heysham Harbour',
    'CNF': 'Carnforth',
    'SVR': 'Silverdale',
    'ARN': 'Arnside',
    'GOS': 'Grange-over-Sands',
    'OXN': 'Oxenholme Lake District',
    'BEN': 'Bentham',
    'WNN': 'Wennington',
    'CPY': 'Clapham (North Yorkshire)',
    'ULV': 'Ulverston',
    'WDM': 'Windermere',
    'KRK': 'Kirkham & Wesham',
    'LTH': 'Layton',
    'SQH': 'Squires Gate',
    'LEA': 'Lea Green',       # near Preston
    'SAC': 'Salwick',
}

# Station coordinates (lat, lon) from NaPTAN / known data
STATION_COORDS = {
    'LAN': (54.0488, -2.8079),
    'PRE': (53.7570, -2.7079),
    'BPN': (53.8212, -3.0494),
    'BPS': (53.7933, -3.0498),
    'BPB': (53.7872, -3.0555),
    'PFY': (53.8477, -2.9939),
    'MCM': (54.0713, -2.8641),
    'BAR': (54.0685, -2.8435),
    'HHB': (54.0328, -2.9155),
    'CNF': (54.1310, -2.7700),
    'SVR': (54.1702, -2.8076),
    'ARN': (54.2037, -2.8298),
    'GOS': (54.1946, -2.9021),
    'OXN': (54.3195, -2.7251),
    'BEN': (54.1160, -2.5083),
    'WNN': (54.1139, -2.5870),
    'CPY': (54.1057, -2.4143),
    'ULV': (54.1938, -3.0942),
    'WDM': (54.3791, -2.9040),
    'KRK': (53.7810, -2.8823),
    'LTH': (53.8352, -3.0340),
    'SQH': (53.7749, -3.0527),
    'SAC': (53.7722, -2.8571),
}


def download_json_gz(url):
    """Download a gzipped JSON file, following redirects."""
    print(f"  Downloading {url}...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Group1-SCC200/1.0'})
    
    # Follow redirects manually
    try:
        response = urllib.request.urlopen(req)
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307, 308):
            redirect_url = e.headers.get('Location')
            if redirect_url:
                response = urllib.request.urlopen(redirect_url)
            else:
                raise
        else:
            raise
    
    data = response.read()
    
    # Try to decompress if gzipped
    try:
        data = gzip.decompress(data)
    except gzip.BadGzipFile:
        pass  # Already decompressed
    
    return data


def stream_schedule_gz(url):
    """Stream the large schedule file line by line, decompressing on the fly."""
    print(f"  Streaming schedule from {url}...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Group1-SCC200/1.0'})
    
    # Get redirect URL first
    try:
        response = urllib.request.urlopen(req)
        actual_url = response.url
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307, 308):
            actual_url = e.headers.get('Location')
        else:
            raise
    
    # Stream and decompress
    response = urllib.request.urlopen(actual_url)
    
    # Read all data first (it's gzipped, must decompress fully)
    raw = response.read()
    try:
        decompressed = gzip.decompress(raw)
    except:
        decompressed = raw
    
    for line in decompressed.decode('utf-8', errors='replace').split('\n'):
        line = line.strip()
        if line:
            yield line


def import_corpus(conn):
    """
    Import CORPUS data into national_rail table.
    Only imports stations in our region.
    """
    print("\n=== Step 1: Import CORPUS (station code mappings) ===")
    
    data = download_json_gz(f"{BASE_URL}/rail/corpus")
    corpus = json.loads(data)
    
    tiploc_data = corpus.get('TIPLOCDATA', [])
    print(f"  Total CORPUS entries: {len(tiploc_data)}")
    
    # Build lookup of all TIPLOCs with CRS codes in our region
    region_crs = set(REGION_STATIONS.keys())
    region_entries = []
    
    for entry in tiploc_data:
        crs = entry.get('3ALPHA', '').strip()
        tiploc = entry.get('TIPLOC', '').strip()
        stanox_str = entry.get('STANOX', '').strip()
        desc = entry.get('NLCDESC', '').strip()
        
        if not tiploc:
            continue
            
        stanox = None
        if stanox_str and stanox_str.isdigit():
            stanox = int(stanox_str)
        
        if crs in region_crs:
            region_entries.append({
                'tiploc': tiploc,
                'crs': crs,
                'stanox': stanox,
                'desc': desc
            })
    
    print(f"  Found {len(region_entries)} TIPLOC entries for our region")
    
    cur = conn.cursor()
    
    # Clear existing data
    cur.execute("DELETE FROM schedule_points")
    cur.execute("DELETE FROM rail_schedule")
    cur.execute("DELETE FROM national_rail")
    conn.commit()
    
    inserted = 0
    for entry in region_entries:
        # Find matching ATCO code in stops table
        atco_code = None
        crs = entry['crs']
        
        # Try to find the rail station stop by coordinates
        if crs in STATION_COORDS:
            lat, lon = STATION_COORDS[crs]
            cur.execute("""
                SELECT atco_code, common_name FROM stops 
                WHERE coordinates IS NOT NULL
                AND ABS(coordinates[0] - %s) < 0.005
                AND ABS(coordinates[1] - %s) < 0.005
                AND (common_name ILIKE '%%rail%%' OR common_name ILIKE '%%railway%%' OR common_name ILIKE '%%station%%')
                ORDER BY ABS(coordinates[0] - %s) + ABS(coordinates[1] - %s)
                LIMIT 1
            """, (lon, lat, lon, lat))
            result = cur.fetchone()
            if result:
                atco_code = result[0]
        
        try:
            cur.execute("""
                INSERT INTO national_rail (tiploc_code, atco_code, crs_code, stanox)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (tiploc_code) DO UPDATE SET
                    crs_code = EXCLUDED.crs_code,
                    stanox = EXCLUDED.stanox,
                    atco_code = EXCLUDED.atco_code
            """, (entry['tiploc'], atco_code, entry['crs'], entry['stanox']))
            inserted += 1
        except Exception as e:
            print(f"  Warning: Could not insert TIPLOC {entry['tiploc']}: {e}")
            conn.rollback()
            continue
    
    conn.commit()
    print(f"  Inserted {inserted} TIPLOC entries into national_rail")
    
    # Show what we have
    cur.execute("""
        SELECT nr.tiploc_code, nr.crs_code, nr.stanox, nr.atco_code, s.common_name
        FROM national_rail nr
        LEFT JOIN stops s ON nr.atco_code = s.atco_code
        ORDER BY nr.crs_code
    """)
    print("\n  Regional rail stations:")
    for row in cur.fetchall():
        linked = f" -> {row[3]} ({row[4]})" if row[3] else " (no bus stop link)"
        print(f"    {row[1]:4s} TIPLOC={row[0]:10s} STANOX={str(row[2] or ''):6s}{linked}")
    
    return {entry['tiploc']: entry['crs'] for entry in region_entries}


def insert_rail_stops(conn):
    """
    Ensure all rail stations in our region have entries in the stops table.
    Uses NaPTAN-style ATCO codes for rail (9100XXXXXXX format).
    """
    print("\n=== Step 2: Ensure rail station stops exist ===")
    
    cur = conn.cursor()
    
    # TIPLOC to NaPTAN ATCO code mapping for rail
    # Rail stations use 9100 prefix + TIPLOC
    tiploc_to_atco = {
        'LANCSTR': '9100LANCSTR',
        'PRST': '9100PRST',
        'BLCKPLN': '9100BLCKPLN',
        'BLCKS': '9100BLCKS',
        'BLCKPB': '9100BLCKPB',
        'PLTNLFY': '9100PLTNLFY',
        'MORCAME': '9100MORCAME',
        'BARELA': '9100BARELA',
        'HEYSHBR': '9100HEYSHBR',
        'CRNF': '9100CRNF',
        'SDAL': '9100SDAL',
        'ARNSIDE': '9100ARNSIDE',
        'GOVS': '9100GOVS',
        'OXENHLM': '9100OXENHLM',
        'BNTHAM': '9100BNTHAM',
        'WENNGTN': '9100WENNGTN',
        'CLPM': '9100CLPM',
        'ULVRSTN': '9100ULVRSTN',
        'WMER': '9100WMER',
    }
    
    tiploc_to_crs = {}
    cur.execute("SELECT tiploc_code, crs_code FROM national_rail WHERE crs_code IS NOT NULL")
    for row in cur.fetchall():
        tiploc_to_crs[row[0]] = row[1]
    
    inserted = 0
    for tiploc, atco in tiploc_to_atco.items():
        crs = tiploc_to_crs.get(tiploc)
        if not crs or crs not in REGION_STATIONS:
            continue
        
        name = REGION_STATIONS[crs] + " Rail Station"
        coords = STATION_COORDS.get(crs)
        if not coords:
            continue
        
        lat, lon = coords
        
        # Check if already exists
        cur.execute("SELECT 1 FROM stops WHERE atco_code = %s", (atco,))
        if cur.fetchone():
            continue
        
        try:
            cur.execute("""
                INSERT INTO stops (atco_code, common_name, coordinates)
                VALUES (%s, %s, point(%s, %s))
            """, (atco, name, lon, lat))
            inserted += 1
            print(f"    Added: {atco} - {name}")
        except Exception as e:
            print(f"    Warning: Could not insert {atco}: {e}")
            conn.rollback()
    
    # Also update national_rail to link to these stops
    for tiploc, atco in tiploc_to_atco.items():
        cur.execute("""
            UPDATE national_rail SET atco_code = %s
            WHERE tiploc_code = %s AND (atco_code IS NULL OR atco_code = '')
        """, (atco, tiploc))
    
    conn.commit()
    print(f"  Inserted {inserted} new rail station stops")


def add_rail_operators(conn):
    """Add rail operators to the operators table."""
    print("\n=== Step 3: Add rail operators ===")
    
    cur = conn.cursor()
    
    rail_operators = [
        ('NT', 'Northern Trains'),
        ('VT', 'Avanti West Coast'),
        ('TP', 'TransPennine Express'),
        ('XC', 'CrossCountry'),
        ('LM', 'London Northwestern Railway'),
        ('GW', 'Great Western Railway'),
        ('GR', 'London North Eastern Railway'),
        ('SR', 'ScotRail'),
        ('ME', 'Merseyrail'),
    ]
    
    inserted = 0
    for code, name in rail_operators:
        cur.execute("SELECT 1 FROM operators WHERE operator_code = %s", (code,))
        if not cur.fetchone():
            try:
                cur.execute(
                    "INSERT INTO operators (operator_code, name, mode) VALUES (%s, %s, %s)",
                    (code, name, 'rail')
                )
                inserted += 1
                print(f"    Added operator: {code} - {name}")
            except Exception as e:
                print(f"    Warning: Could not insert operator {code}: {e}")
                conn.rollback()
    
    conn.commit()
    print(f"  Added {inserted} new rail operators")


def import_schedule(conn, region_tiplocs):
    """
    Import rail schedule data.
    Downloads the daily timetable and extracts trains serving our region.
    """
    print("\n=== Step 4: Import rail schedule (this may take a few minutes) ===")
    
    cur = conn.cursor()
    
    # Clear existing schedule data
    cur.execute("DELETE FROM schedule_points")
    cur.execute("DELETE FROM rail_schedule")
    conn.commit()
    
    # Build set of TIPLOCs in our region for fast lookup
    region_tiploc_set = set(region_tiplocs.keys())
    
    # Also add junction/passing TIPLOCs near our region
    # These are intermediate points trains pass through
    extra_tiplocs = set()
    
    today = date.today()
    day_of_week = today.weekday()  # Monday=0, Sunday=6
    
    schedules_found = 0
    schedules_inserted = 0
    points_inserted = 0
    skipped_dates = 0
    skipped_days = 0
    
    print(f"  Today is {today.strftime('%A %Y-%m-%d')} (day index {day_of_week})")
    print(f"  Looking for trains through {len(region_tiploc_set)} regional TIPLOCs...")
    print(f"  Streaming schedule data...")
    
    batch_schedules = []
    batch_points = []
    line_count = 0
    
    for line in stream_schedule_gz(f"{BASE_URL}/rail/schedule"):
        line_count += 1
        if line_count % 50000 == 0:
            print(f"    Processed {line_count} records, found {schedules_found} regional trains...")
        
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        
        # Only process schedule records
        if 'JsonScheduleV1' not in record:
            continue
        
        sched = record['JsonScheduleV1']
        
        # Skip cancellations
        stp_indicator = sched.get('CIF_stp_indicator', '')
        if stp_indicator == 'C':
            continue
        
        train_uid = sched.get('CIF_train_uid', '')
        if not train_uid:
            continue
        
        # Check date validity
        start_date = sched.get('schedule_start_date', '')
        end_date = sched.get('schedule_end_date', '')
        
        try:
            s_date = datetime.strptime(start_date, '%Y-%m-%d').date() if start_date else None
            e_date = datetime.strptime(end_date, '%Y-%m-%d').date() if end_date else None
        except ValueError:
            continue
        
        if s_date and e_date:
            if today < s_date or today > e_date:
                skipped_dates += 1
                continue
        
        # Check days_run (Monday=bit0, Sunday=bit6)
        days_run = sched.get('schedule_days_runs', '0000000')
        if len(days_run) >= 7:
            if days_run[day_of_week] != '1':
                skipped_days += 1
                continue
        
        # Get schedule segment
        segment = sched.get('schedule_segment', {})
        if not segment:
            continue
        
        locations = segment.get('schedule_location', [])
        if not locations:
            continue
        
        # Check if this train passes through any of our regional stations
        train_tiplocs = [loc.get('tiploc_code', '') for loc in locations]
        regional_stops = [t for t in train_tiplocs if t in region_tiploc_set]
        
        if len(regional_stops) < 1:
            continue
        
        # This train serves our region!
        schedules_found += 1
        
        atoc_code = sched.get('atoc_code', '').strip()
        
        # Make train_uid unique by appending STP indicator if overlay
        unique_uid = train_uid
        if stp_indicator == 'O':
            unique_uid = train_uid + '_O'
        elif stp_indicator == 'N':
            unique_uid = train_uid + '_N'
        
        # Check for duplicate UIDs
        cur.execute("SELECT 1 FROM rail_schedule WHERE train_uid = %s", (unique_uid,))
        if cur.fetchone():
            # STP overlay takes precedence over permanent
            if stp_indicator in ('O', 'N'):
                cur.execute("DELETE FROM schedule_points WHERE train_uid = %s", (unique_uid.replace('_O','').replace('_N','')))
                cur.execute("DELETE FROM rail_schedule WHERE train_uid = %s", (unique_uid.replace('_O','').replace('_N','')))
            else:
                continue
        
        # Check if operator exists
        operator_code = atoc_code if atoc_code else None
        if operator_code:
            cur.execute("SELECT 1 FROM operators WHERE operator_code = %s", (operator_code,))
            if not cur.fetchone():
                operator_code = None
        
        try:
            cur.execute("""
                INSERT INTO rail_schedule (train_uid, operator_code, schedule_start_date, schedule_end_date, days_run)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (train_uid) DO NOTHING
            """, (unique_uid, operator_code, s_date, e_date, days_run.encode()))
            schedules_inserted += 1
        except Exception as e:
            conn.rollback()
            continue
        
        # Insert schedule points (stops on this train)
        for seq, loc in enumerate(locations):
            tiploc = loc.get('tiploc_code', '').strip()
            if not tiploc:
                continue
            
            # Only insert points for TIPLOCs we have in national_rail
            # (we need foreign key to work)
            cur.execute("SELECT 1 FROM national_rail WHERE tiploc_code = %s", (tiploc,))
            if not cur.fetchone():
                # Add this TIPLOC to national_rail as a pass-through point
                try:
                    cur.execute("""
                        INSERT INTO national_rail (tiploc_code, crs_code, stanox)
                        VALUES (%s, NULL, NULL)
                        ON CONFLICT (tiploc_code) DO NOTHING
                    """, (tiploc,))
                except:
                    conn.rollback()
                    continue
            
            # Parse times
            arrival = loc.get('public_arrival') or loc.get('arrival')
            departure = loc.get('public_departure') or loc.get('departure')
            pass_time = loc.get('pass')
            
            # Use pass time if no arrival/departure
            if not arrival and not departure and pass_time:
                # This is a pass-through point, skip for passenger schedule
                continue
            
            # Clean time format (remove trailing H for half-minutes)
            def clean_time(t):
                if not t:
                    return None
                t = t.strip().replace('H', '')
                if len(t) == 4:
                    return f"{t[:2]}:{t[2:]}:00"
                elif len(t) == 5:
                    return t + ":00"
                return t
            
            arr_time = clean_time(arrival)
            dep_time = clean_time(departure)
            
            if not arr_time and not dep_time:
                continue
            
            try:
                # Get next ID
                cur.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM schedule_points")
                next_id = cur.fetchone()[0]
                
                cur.execute("""
                    INSERT INTO schedule_points (id, tiploc_code, train_uid, arrival_time, departure_time, sequence_order)
                    VALUES (%s, %s, %s, %s::time, %s::time, %s)
                """, (next_id, tiploc, unique_uid, arr_time, dep_time, seq))
                points_inserted += 1
            except Exception as e:
                conn.rollback()
                continue
        
        # Commit every 100 trains
        if schedules_inserted % 100 == 0:
            conn.commit()
    
    conn.commit()
    
    print(f"\n  Schedule import complete:")
    print(f"    Lines processed: {line_count}")
    print(f"    Trains serving our region: {schedules_found}")
    print(f"    Schedules inserted: {schedules_inserted}")
    print(f"    Schedule points inserted: {points_inserted}")
    print(f"    Skipped (wrong date range): {skipped_dates}")
    print(f"    Skipped (not running today): {skipped_days}")


def show_summary(conn):
    """Show a summary of imported rail data."""
    print("\n=== Rail Data Summary ===")
    
    cur = conn.cursor()
    
    cur.execute("SELECT COUNT(*) FROM national_rail")
    print(f"  TIPLOC entries: {cur.fetchone()[0]}")
    
    cur.execute("SELECT COUNT(*) FROM national_rail WHERE crs_code IS NOT NULL")
    print(f"  Stations with CRS codes: {cur.fetchone()[0]}")
    
    cur.execute("SELECT COUNT(*) FROM rail_schedule")
    print(f"  Train schedules: {cur.fetchone()[0]}")
    
    cur.execute("SELECT COUNT(*) FROM schedule_points")
    print(f"  Schedule points: {cur.fetchone()[0]}")
    
    # Show trains by operator
    cur.execute("""
        SELECT rs.operator_code, o.name, COUNT(*) as train_count
        FROM rail_schedule rs
        LEFT JOIN operators o ON rs.operator_code = o.operator_code
        WHERE rs.operator_code IS NOT NULL
        GROUP BY rs.operator_code, o.name
        ORDER BY train_count DESC
    """)
    print("\n  Trains by operator:")
    for row in cur.fetchall():
        name = row[1] or row[0]
        print(f"    {row[0]:4s} {name:35s} {row[2]:4d} trains")
    
    # Show example departures from Lancaster
    cur.execute("""
        SELECT rs.train_uid, rs.operator_code, 
               sp.departure_time, sp.arrival_time,
               nr.crs_code
        FROM schedule_points sp
        JOIN rail_schedule rs ON sp.train_uid = rs.train_uid
        JOIN national_rail nr ON sp.tiploc_code = nr.tiploc_code
        WHERE nr.crs_code = 'LAN'
        AND sp.departure_time IS NOT NULL
        ORDER BY sp.departure_time
        LIMIT 15
    """)
    results = cur.fetchall()
    if results:
        print("\n  Sample departures from Lancaster today:")
        for row in results:
            time = row[2].strftime('%H:%M') if row[2] else row[3].strftime('%H:%M')
            print(f"    {time}  Train {row[0]:8s}  Operator: {row[1] or '??'}")
    
    # Show connectivity between key stations
    print("\n  Rail connections between key stations:")
    station_pairs = [
        ('LAN', 'PRE', 'Lancaster → Preston'),
        ('PRE', 'BPN', 'Preston → Blackpool North'),
        ('LAN', 'MCM', 'Lancaster → Morecambe'),
        ('LAN', 'CNF', 'Lancaster → Carnforth'),
        ('PRE', 'LAN', 'Preston → Lancaster'),
    ]
    
    for crs1, crs2, desc in station_pairs:
        cur.execute("""
            SELECT COUNT(DISTINCT sp1.train_uid)
            FROM schedule_points sp1
            JOIN national_rail nr1 ON sp1.tiploc_code = nr1.tiploc_code
            JOIN schedule_points sp2 ON sp1.train_uid = sp2.train_uid
            JOIN national_rail nr2 ON sp2.tiploc_code = nr2.tiploc_code
            WHERE nr1.crs_code = %s AND nr2.crs_code = %s
            AND sp1.sequence_order < sp2.sequence_order
        """, (crs1, crs2))
        count = cur.fetchone()[0]
        print(f"    {desc:35s} {count:3d} trains today")


def main():
    print("=" * 60)
    print("Rail Data Import for Group 1 Transport Application")
    print(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)
    
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        print("Connected to database")
    except Exception as e:
        print(f"Error connecting to database: {e}")
        sys.exit(1)
    
    try:
        # Step 1: Import CORPUS
        region_tiplocs = import_corpus(conn)
        
        # Step 2: Insert rail station stops
        insert_rail_stops(conn)
        
        # Step 3: Add rail operators
        add_rail_operators(conn)
        
        # Step 4: Import schedule
        import_schedule(conn, region_tiplocs)
        
        # Summary
        show_summary(conn)
        
    except KeyboardInterrupt:
        print("\n\nImport interrupted by user")
        conn.commit()
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        conn.rollback()
    finally:
        conn.close()
    
    print("\nDone!")


if __name__ == '__main__':
    main()
