#!/usr/bin/env python3
"""
Import NaPTAN XML data into the stops table
"""

import xml.etree.ElementTree as ET
import psycopg2

# Database configuration
DB_CONFIG = {
    'host': 'localhost',
    'port': 5050,
    'database': 'group1db',
    'user': 'postgres',
    'password': 'group1'
}

def parse_naptan_xml(xml_file):
    """Parse NaPTAN XML and extract stop information"""
    print(f"Parsing {xml_file}...")
    
    # Parse XML
    tree = ET.parse(xml_file)
    root = tree.getroot()
    
    # Define namespace
    ns = {'naptan': 'http://www.naptan.org.uk/'}
    
    stops = []
    
    # Find all StopPoint elements (individual bus stops)
    for stop_point in root.findall('.//naptan:StopPoint', ns):
        # Extract AtcoCode
        atco_code_elem = stop_point.find('naptan:AtcoCode', ns)
        if atco_code_elem is None or not atco_code_elem.text:
            continue
            
        atco_code = atco_code_elem.text.strip()
        
        # Extract CommonName
        common_name_elem = stop_point.find('.//naptan:Descriptor/naptan:CommonName', ns)
        common_name = common_name_elem.text if common_name_elem is not None else None
        
        # Extract coordinates
        lon_elem = stop_point.find('.//naptan:Location/naptan:Translation/naptan:Longitude', ns)
        lat_elem = stop_point.find('.//naptan:Location/naptan:Translation/naptan:Latitude', ns)
        
        longitude = float(lon_elem.text) if lon_elem is not None and lon_elem.text else None
        latitude = float(lat_elem.text) if lat_elem is not None and lat_elem.text else None
        
        # Extract StopType
        stop_type_elem = stop_point.find('.//naptan:StopClassification/naptan:StopType', ns)
        stop_type = stop_type_elem.text if stop_type_elem is not None else None
        
        stops.append({
            'atco_code': atco_code,
            'common_name': common_name,
            'longitude': longitude,
            'latitude': latitude,
            'stop_type': stop_type
        })
    
    # Find all StopArea elements (transit hubs like bus stations)
    for stop_area in root.findall('.//naptan:StopArea', ns):
        # Extract StopAreaCode
        stop_code_elem = stop_area.find('naptan:StopAreaCode', ns)
        if stop_code_elem is None or not stop_code_elem.text:
            continue
            
        atco_code = stop_code_elem.text.strip()
        
        # Extract Name
        name_elem = stop_area.find('.//naptan:Name', ns)
        common_name = name_elem.text if name_elem is not None else None
        
        # Extract coordinates
        lon_elem = stop_area.find('.//naptan:Location/naptan:Translation/naptan:Longitude', ns)
        lat_elem = stop_area.find('.//naptan:Location/naptan:Translation/naptan:Latitude', ns)
        
        longitude = float(lon_elem.text) if lon_elem is not None and lon_elem.text else None
        latitude = float(lat_elem.text) if lat_elem is not None and lat_elem.text else None
        
        # Extract StopAreaType
        area_type_elem = stop_area.find('naptan:StopAreaType', ns)
        stop_type = area_type_elem.text if area_type_elem is not None else None
        
        stops.append({
            'atco_code': atco_code,
            'common_name': common_name,
            'longitude': longitude,
            'latitude': latitude,
            'stop_type': stop_type
        })
    
    print(f"Parsed {len(stops)} stops and transit hubs from XML")
    return stops

def insert_stops(stops):
    """Insert stops into the database"""
    print("Connecting to database...")
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    
    try:
        # Clear existing data
        print("Clearing existing stops data...")
        cur.execute("TRUNCATE TABLE stops CASCADE")
        
        # Insert stops
        print(f"Inserting {len(stops)} stops...")
        inserted = 0
        skipped = 0
        
        for stop in stops:
            try:
                # Create POINT(longitude, latitude) for coordinates
                if stop['longitude'] is not None and stop['latitude'] is not None:
                    cur.execute(
                        """
                        INSERT INTO stops (atco_code, common_name, coordinates, stop_type)
                        VALUES (%s, %s, POINT(%s, %s), %s)
                        ON CONFLICT (atco_code) DO UPDATE
                        SET common_name = EXCLUDED.common_name,
                            coordinates = EXCLUDED.coordinates,
                            stop_type = EXCLUDED.stop_type
                        """,
                        (stop['atco_code'], stop['common_name'], 
                         stop['longitude'], stop['latitude'], stop['stop_type'])
                    )
                else:
                    # Insert without coordinates
                    cur.execute(
                        """
                        INSERT INTO stops (atco_code, common_name, stop_type)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (atco_code) DO UPDATE
                        SET common_name = EXCLUDED.common_name,
                            stop_type = EXCLUDED.stop_type
                        """,
                        (stop['atco_code'], stop['common_name'], stop['stop_type'])
                    )
                inserted += 1
                
                if inserted % 1000 == 0:
                    print(f"  Inserted {inserted} stops...")
                    
            except Exception as e:
                skipped += 1
                if skipped <= 10:  # Only print first 10 errors
                    print(f"  Error inserting stop {stop['atco_code']}: {e}")
        
        conn.commit()
        print(f"\n✓ Successfully inserted {inserted} stops")
        if skipped > 0:
            print(f"  Skipped {skipped} stops due to errors")
        
        # Show some statistics
        cur.execute("SELECT COUNT(*) FROM stops")
        total = cur.fetchone()[0]
        print(f"\nTotal stops in database: {total}")
        
        cur.execute("SELECT stop_type, COUNT(*) FROM stops WHERE stop_type IS NOT NULL GROUP BY stop_type ORDER BY COUNT(*) DESC LIMIT 10")
        print("\nTop stop types:")
        for stop_type, count in cur.fetchall():
            print(f"  {stop_type}: {count}")
        
    except Exception as e:
        conn.rollback()
        print(f"Error: {e}")
        raise
    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    xml_file = 'naptan.xml'
    
    print("=" * 50)
    print("NaPTAN Data Import")
    print("=" * 50)
    
    # Parse XML
    stops = parse_naptan_xml(xml_file)
    
    # Insert into database
    insert_stops(stops)
    
    print("\n" + "=" * 50)
    print("Import complete!")
    print("=" * 50)
