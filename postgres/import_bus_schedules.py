#!/usr/bin/env python3
"""
Import bus schedule data from TransXChange XML files
Downloads schedules from transport.scc.lancs.ac.uk for each operator
"""

import json
import requests
import zipfile
import io
import xml.etree.ElementTree as ET
import psycopg2
from datetime import datetime, time
import os
import tempfile

# Database configuration
DB_CONFIG = {
    'host': 'localhost',
    'port': 5050,
    'database': 'group1db',
    'user': 'postgres',
    'password': 'group1'
}

BASE_URL = "https://transport.scc.lancs.ac.uk"

# Geographic bounds for Lancaster-Preston area
# Approximate bounding box
LANCASTER_PRESTON_BOUNDS = {
    'min_lat': 53.7,   # South of Preston
    'max_lat': 54.1,   # North of Lancaster
    'min_lon': -3.0,   # West boundary
    'max_lon': -2.5    # East boundary
}

# Operators to always include (ignore locality filter)
ALWAYS_INCLUDE_OPERATORS = {
    'SCCU',  # Stagecoach Cumbria & North Lancashire
    'SCMY'   # Stagecoach Merseyside & South Lancashire
}

# Localities in Lancaster–Preston corridor + coastal Fylde/Wyre region
VALID_LOCALITIES = [
    'Lancaster', 'Preston', 'Garstang', 'Galgate', 'Forton', 'Scorton',
    'Bilsborrow', 'Barton', 'Broughton', 'Fulwood', 'Ashton-on-Ribble',
    'Ingol', 'Cottam', 'Catforth', 'Bay Horse', 'Catterall', 'Brock',
    'Dolphinholme', 'Ellel', 'Hest Bank', 'Slyne', 'Bolton-le-Sands',
    'Carnforth', 'Halton', 'Lancaster University', 'Bailrigg',
    'Blackpool', 'Fylde', 'Wyre', 'Fleetwood', 'Poulton-le-Fylde',
    'Thornton', 'Cleveleys', 'Bispham', 'Layton', 'Marton', 'St Annes',
    'Lytham', 'Kirkham', 'Wesham', 'Freckleton', 'Warton', 'Singleton',
    'Great Eccleston', 'Little Eccleston', 'Elswick', 'Pilling',
    'Knott End', 'Preesall', 'Stalmine', 'Hamlet', 'Weeton'
]

def get_operators():
    """Get all bus operators from database"""
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    cur.execute("SELECT operator_code, name FROM operators WHERE mode = 'bus'")
    operators = cur.fetchall()
    cur.close()
    conn.close()
    return operators

def is_in_lancaster_preston_area(localities):
    """Check if dataset covers Lancaster-Preston area"""
    if not localities:
        return True  # Include if no locality info
    
    locality_names = [loc.get('name', '') for loc in localities]
    
    # Check if any locality is in our valid list
    for locality in locality_names:
        for valid in VALID_LOCALITIES:
            if valid.lower() in locality.lower():
                return True
    
    return False

def fetch_operator_datasets(operator_code):
    """Fetch list of datasets for an operator"""
    url = f"{BASE_URL}/bus/times/{operator_code}"
    print(f"  Fetching datasets from {url}")
    
    try:
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
        
        results = data.get('results', [])

        if operator_code in ALWAYS_INCLUDE_OPERATORS:
            return results

        # Filter for Lancaster-Preston area
        filtered = [r for r in results if is_in_lancaster_preston_area(r.get('localities', []))]
        
        if len(filtered) < len(results):
            print(f"  Filtered to {len(filtered)} datasets in Lancaster-Preston area (from {len(results)})")
        
        return filtered
    except Exception as e:
        print(f"  Error fetching datasets: {e}")
        return []

def select_preferred_datasets(datasets, operator_code):
    """Prefer region-specific Stagecoach datasets for SCCU/SCMY."""
    if operator_code == 'SCCU':
        preferred = [d for d in datasets if d.get('id') == 18047]
        if preferred:
            return preferred
        preferred = [d for d in datasets if 'Cumbria & North Lancashire' in (d.get('description') or '')]
        return preferred or datasets
    if operator_code == 'SCMY':
        preferred = [d for d in datasets if 'Merseyside & South Lancashire' in (d.get('description') or '')]
        return preferred or datasets
    return datasets

def download_dataset(dataset_url):
    """Download a dataset file (XML or ZIP)"""
    print(f"    Downloading {dataset_url}")
    
    try:
        response = requests.get(dataset_url)
        response.raise_for_status()
        return response.content
    except Exception as e:
        print(f"    Error downloading: {e}")
        return None

def parse_transxchange_xml(xml_content, operator_code):
    """Parse TransXChange XML and extract services and schedules"""
    services = []
    
    try:
        root = ET.fromstring(xml_content)
        
        # Define TransXChange namespace
        ns = {'txc': 'http://www.transxchange.org.uk/'}
        
        # Parse each Service
        for service_elem in root.findall('.//txc:Service', ns):
            # Get service code and line names
            service_code = service_elem.find('txc:ServiceCode', ns)
            service_code_text = service_code.text if service_code is not None else 'UNKNOWN'
            
            # Get line names
            lines = service_elem.findall('.//txc:LineName', ns)
            route_number = lines[0].text if lines else 'UNKNOWN'
            
            # Get operating period
            start_date = None
            end_date = None
            operating_period = service_elem.find('.//txc:OperatingPeriod', ns)
            if operating_period is not None:
                start_elem = operating_period.find('txc:StartDate', ns)
                end_elem = operating_period.find('txc:EndDate', ns)
                if start_elem is not None:
                    start_date = start_elem.text
                if end_elem is not None:
                    end_date = end_elem.text
            
            # Get journey patterns and vehicle journeys
            for journey_pattern in service_elem.findall('.//txc:JourneyPattern', ns):
                jp_id = journey_pattern.get('id')
                direction = journey_pattern.find('txc:Direction', ns)
                direction_text = direction.text if direction is not None else 'outbound'
                
                # Build stop sequence from JourneyPatternSection
                stop_sequence = []
                section_ref = journey_pattern.find('.//txc:JourneyPatternSectionRefs', ns)
                if section_ref is not None:
                    section_id = section_ref.text
                    # Find the corresponding section
                    section = root.find(f".//txc:JourneyPatternSection[@id='{section_id}']", ns)
                    if section is not None:
                        for link in section.findall('.//txc:JourneyPatternTimingLink', ns):
                            from_stop = link.find('.//txc:From/txc:StopPointRef', ns)
                            to_stop = link.find('.//txc:To/txc:StopPointRef', ns)
                            
                            if from_stop is not None:
                                stop_sequence.append(from_stop.text)
                            if to_stop is not None and to_stop.text not in stop_sequence:
                                stop_sequence.append(to_stop.text)
                
                # Find vehicle journeys for this pattern
                for vj in root.findall(f".//txc:VehicleJourney[txc:JourneyPatternRef='{jp_id}']", ns):
                    # Get departure time
                    departure_time = vj.find('txc:DepartureTime', ns)
                    if departure_time is None:
                        continue
                    
                    base_time = departure_time.text
                    
                    # Get days of operation
                    days_of_week = []
                    days_elem = vj.find('.//txc:DaysOfWeek', ns)
                    if days_elem is not None:
                        for day in ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']:
                            if days_elem.find(f'txc:{day}', ns) is not None:
                                days_of_week.append(day[:3])
                    days_text = ','.join(days_of_week) if days_of_week else 'Daily'
                    
                    # Build schedule points with timing
                    schedule_points = []
                    seq = 0
                    
                    for stop_ref in stop_sequence:
                        atco_code = stop_ref.strip() if stop_ref else None
                        
                        if atco_code:
                            schedule_points.append({
                                'atco_code': atco_code,
                                'sequence': seq,
                                'time': base_time  # Simplified - would need offset calculation
                            })
                            seq += 1
                    
                    if schedule_points:
                        services.append({
                            'operator_code': operator_code,
                            'route_number': route_number,
                            'direction': direction_text,
                            'start_date': start_date,
                            'end_date': end_date,
                            'days_of_operation': days_text,
                            'schedule_points': schedule_points
                        })
        
    except Exception as e:
        print(f"    Error parsing XML: {e}")
    
    return services

def insert_services(services):
    """Insert services and schedule points into database"""
    if not services:
        return 0
    
    inserted = 0
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    
    for service in services:
        try:
            # Insert service
            cur.execute(
                """
                INSERT INTO bus_services 
                (operator_code, route_number, direction, start_date, end_date, days_of_operation)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING service_id
                """,
                (service['operator_code'], service['route_number'], service['direction'],
                 service['start_date'], service['end_date'], service['days_of_operation'])
            )
            service_id = cur.fetchone()[0]
            
            # Insert schedule points - use savepoints
            points_inserted = 0
            for point in service['schedule_points']:
                try:
                    cur.execute("SAVEPOINT sp1")
                    cur.execute(
                        """
                        INSERT INTO bus_schedule_points
                        (service_id, atco_code, arrival_time, departure_time, sequence_order)
                        VALUES (%s, %s, %s, %s, %s)
                        """,
                        (service_id, point['atco_code'], point['time'], point['time'], point['sequence'])
                    )
                    cur.execute("RELEASE SAVEPOINT sp1")
                    points_inserted += 1
                except:
                    cur.execute("ROLLBACK TO SAVEPOINT sp1")
            
            # Commit the service if we inserted some points
            if points_inserted > 0:
                conn.commit()
                inserted += 1
            else:
                conn.rollback()
                
        except Exception as e:
            print(f"      Service error: {e}")
            conn.rollback()
    
    cur.close()
    conn.close()
    
    return inserted

def process_operator(operator_code, operator_name):
    """Process all datasets for an operator"""
    print(f"\nProcessing {operator_name} ({operator_code})")
    
    datasets = select_preferred_datasets(fetch_operator_datasets(operator_code), operator_code)
    
    if not datasets:
        print(f"  No datasets found in Lancaster-Preston area")
        return 0
    
    print(f"  Found {len(datasets)} datasets in Lancaster-Preston area")
    
    total_services = 0
    
    dataset_limit = 1
    if operator_code == 'BLAC':
        dataset_limit = 3

    for dataset in datasets[:dataset_limit]:  # Process a limited number of datasets per operator
        print(f"  Dataset: {dataset['name']}")
        download_url = dataset.get('url')
        
        if not download_url:
            continue
        
        content = download_dataset(download_url)
        if not content:
            continue
        
        # Handle ZIP files
        if dataset.get('extension') == 'zip':
            try:
                with zipfile.ZipFile(io.BytesIO(content)) as zf:
                    xml_files = [f for f in zf.namelist() if f.endswith('.xml')]
                    print(f"    Found {len(xml_files)} XML files in ZIP")
                    
                    max_xml = 2
                    if operator_code == 'SCCU' and dataset.get('id') == 18047:
                        max_xml = 25
                    if operator_code == 'BLAC':
                        max_xml = 25

                    processed = 0
                    for xml_file in xml_files:
                        if processed >= max_xml:
                            break
                        print(f"    Processing {xml_file}")
                        xml_content = zf.read(xml_file)
                        services = parse_transxchange_xml(xml_content, operator_code)
                        inserted = insert_services(services)
                        total_services += inserted
                        print(f"      Inserted {inserted} services")
                        processed += 1

                        if operator_code == 'SCCU' and inserted > 0:
                            break
            except Exception as e:
                print(f"    Error processing ZIP: {e}")
        
        # Handle XML files
        elif dataset.get('extension') == 'xml':
            services = parse_transxchange_xml(content, operator_code)
            inserted = insert_services(services)
            total_services += inserted
            print(f"    Inserted {inserted} services")
    
    print(f"  Total services inserted for {operator_code}: {total_services}")
    return total_services

def main():
    print("=" * 60)
    print("Bus Schedule Import")
    print("=" * 60)
    
    # Get operators
    operators = get_operators()
    print(f"\nFound {len(operators)} bus operators")
    
    # Clear existing data
    print("\nClearing existing bus schedule data...")
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    cur.execute("TRUNCATE bus_services CASCADE")
    conn.commit()
    cur.close()
    conn.close()
    
    # Process each operator
    total = 0
    for operator_code, operator_name in operators:
        try:
            count = process_operator(operator_code, operator_name)
            total += count
        except Exception as e:
            print(f"Error processing {operator_code}: {e}")
    
    print("\n" + "=" * 60)
    print(f"Import complete! Total services: {total}")
    print("=" * 60)
    
    # Show statistics
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM bus_services")
    service_count = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM bus_schedule_points")
    point_count = cur.fetchone()[0]
    print(f"\nDatabase statistics:")
    print(f"  Services: {service_count}")
    print(f"  Schedule points: {point_count}")
    cur.close()
    conn.close()

if __name__ == '__main__':
    main()
