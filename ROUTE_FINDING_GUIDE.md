# Route Finding Feature Guide

## Overview

The application now supports finding bus routes between two locations in the Lancaster-Morecambe-Heysham region. The system can find:

1. **Direct routes** - Single bus route serving both stops
2. **Transfer routes** - Multi-leg journeys requiring one or more bus changes
3. **Journey details** - Travel times, operator information, stop sequences

## Database Schema

### Tables Used for Route Finding

#### `bus_routes`
- Defines complete bus routes from start to end point
- Fields: `route_id`, `route_number`, `operator_code`, `start_atco_code`, `end_atco_code`
- Example: Route 45 (ARCT) from William Mitchell to East View Terrace

#### `route_stops`
- Defines each stop along a route in order
- Fields: `stop_id`, `route_id`, `atco_code`, `stop_sequence`, `travel_time_to_next`
- Includes estimated travel time between consecutive stops (in seconds)
- Calculated using haversine distance formula with ~20 km/h average bus speed

## Importing Bus Routes

### Step 1: From Campus or with VPN Access

The bus routes can be imported from the official UK transport API:

```bash
# Run the import script to fetch real bus data
cd /home/bylesl/h-drive/Year\ 2/SCC200
./scripts/import_routes.sh

# Import for specific operator (optional)
./scripts/import_routes.sh ARCT
```

**Supported operators:**
- `ARCT` - Archway Travel
- `BLAC` - Blackpool Transport
- `KLCO` - Kirkby Lonsdale Coach Hire
- `SCCU` - Stagecoach Cumbria & North Lancashire
- `SCMY` - Stagecoach Merseyside & South Lancashire
- `NUTT` - Transpora North West

### Step 2: Direct Database Population (If API Not Available)

If you cannot access the API, manually insert routes:

```sql
-- Insert a route
INSERT INTO bus_routes (route_number, operator_code, start_atco_code, end_atco_code)
VALUES ('45', 'ARCT', '25001001', '250010001')
RETURNING route_id;

-- Get the route_id from the response, then add stops
INSERT INTO route_stops (route_id, atco_code, stop_sequence, travel_time_to_next)
VALUES 
  (1, '25001001', 0, 120),  -- First stop, 2 minutes to next
  (1, '25001002', 1, 180),  -- Second stop, 3 minutes to next
  (1, '250010001', 2, NULL); -- Final stop
```

## Using the Route Finding API

### Endpoint: `GET /api/routes`

Find routes between two bus stops.

**Parameters:**
- `start` (required): ATCO code of start location
- `end` (required): ATCO code of end location

**Example Request:**
```bash
# Find routes from Morecambe to a nearby stop
curl "http://localhost:5000/api/routes?start=250012161&end=250010001"
```

**Response Format:**
```json
{
  "start": {
    "atco_code": "250012161",
    "common_name": "Lancaster and Morecambe College",
    "coordinates": "(-2.7,53.5)"
  },
  "end": {
    "atco_code": "250010001",
    "common_name": "East View Terrace",
    "coordinates": "(-2.5,53.7)"
  },
  "directRoutes": [
    {
      "route_id": 1,
      "route_number": "45",
      "operator_code": "ARCT",
      "stops": ["25001001", "25001002", "250010001"],
      "travel_times": [120, 180, null],
      "total_time": 300,
      "route_type": "direct"
    }
  ],
  "transferOptions": [
    {
      "start_route": "12",
      "end_route": "45",
      "transfer_stop": "250010020",
      "type": "transfer"
    }
  ],
  "totalOptions": 1
}
```

## Frontend Integration

### Current Search Features

The frontend displays bus stops in a dropdown when users search for locations:

```javascript
// SearchBar.js
const filtered = stops.filter(stop => 
  stop.common_name.toLowerCase().includes(input.toLowerCase())
);
```

### Future Enhancement: Route Display

To show routes on the map:

1. **When user selects start location**: Search for routes from that stop
2. **When user selects end location**: Call `/api/routes?start=X&end=Y`
3. **Display results**: Show available routes with:
   - Route number and operator
   - Number of stops
   - Estimated travel time
   - Option to see stop details

### Example Frontend Code (To Be Implemented)

```javascript
// In App.js or a RouteResults component
async function findRoutes(startCode, endCode) {
  const response = await fetch(
    `/api/routes?start=${startCode}&end=${endCode}`
  );
  const data = await response.json();
  
  return {
    directRoutes: data.directRoutes,
    transfers: data.transferOptions
  };
}

// When user selects start and end locations
const routes = await findRoutes(
  startLocation.atco_code,
  endLocation.atco_code
);

// Display on map - can draw polyline for each route
```

## Example Workflows

### Scenario 1: Direct Route (Morecambe to Lancaster)

If Archway Travel route 45 serves both locations:

```
Stop 1: William Mitchell (25001001)
        ↓ 2 min
Stop 2: Hawkshead Drive (25001002)
        ↓ 3 min
Stop 3: East View Terrace (250010001)

Total Journey: ~5 minutes
```

### Scenario 2: Transfer Required (Morecambe to Heysham)

If no single route connects both:

```
Route 45 (ARCT):
  Morecambe → [Multiple stops] → Warner Street (250010020)

Transfer at Warner Street

Route 12 (BLAC):
  Warner Street (250010020) → [Multiple stops] → Heysham

Total Journey: ~45 minutes (including transfer time)
```

## Database Queries for Analysis

### See all imported routes
```sql
SELECT route_number, operator_code, 
       (SELECT common_name FROM stops WHERE atco_code = start_atco_code) as start,
       (SELECT common_name FROM stops WHERE atco_code = end_atco_code) as end
FROM bus_routes
ORDER BY operator_code, route_number;
```

### Check route stops and timings
```sql
SELECT rs.stop_sequence,
       rs.atco_code,
       s.common_name,
       rs.travel_time_to_next
FROM route_stops rs
JOIN stops s ON rs.atco_code = s.atco_code
WHERE rs.route_id = 1  -- Replace with actual route_id
ORDER BY rs.stop_sequence;
```

### Find routes serving a specific stop
```sql
SELECT DISTINCT br.route_number, br.operator_code
FROM bus_routes br
JOIN route_stops rs ON br.route_id = rs.route_id
WHERE rs.atco_code = '250012161'  -- Replace with actual stop
ORDER BY br.operator_code, br.route_number;
```

## Travel Time Estimation

Travel times between stops are estimated using:

1. **Haversine distance formula** - Calculates distance between coordinates
2. **Average bus speed** - 20 km/h = ~333 meters/minute
3. **Formula**: `time (seconds) = distance (meters) / 333`

This provides reasonable estimates for urban bus routes. For production, actual timetable data should be used.

## Troubleshooting

### No routes found
- Ensure bus routes have been imported (database tables populated)
- Verify ATCO codes exist in the `stops` table
- Check that routes have at least 2 valid stops

### Incorrect travel times
- Travel times are estimates based on distance
- For accurate times, import from TransXChange timetable data
- See `import_bus_schedules.py` for schedule integration

### Import script fails
- Ensure VPN access to campus (required for API)
- Check internet connectivity
- Verify database connection (localhost:5050)
- Review logs: `podman logs group1-backend`

## Next Steps

1. **Run import script** to populate routes from live API
2. **Test with example locations** (Morecambe, Heysham, Lancaster)
3. **Implement frontend route display** with polylines on map
4. **Add journey details** component showing stops, times, transfers
5. **Integrate live vehicle tracking** using journey_tracking table
