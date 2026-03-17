# Filter Updates Documentation

**Branch:** filter-updates  
**Date:** 8 March 2026  
**Summary:** UI/UX improvements including responsive design, filter-controlled map markers, and enhanced transport stop information.

---

## 1. Responsive Design Implementation

### 1.1 Viewport-Based Sizing (VW Units)
**Files Modified:**
- `frontend/src/App.css`
- `frontend/src/components/SearchBar.css`
- `frontend/src/components/BottomControls.css`
- `frontend/src/components/FilterPage.css`

**Changes:**
- Converted fixed pixel values to `clamp()` and `vw` units for fluid scaling
- Controls now resize proportionally with screen width
- Button sizes, input fields, and spacing adapt to viewport
- Implemented breakpoints at 768px, 480px, and 380px for mobile optimization

**Benefits:**
- Buttons and text fields shrink/grow smoothly as screen size changes
- Better usability on tablets and mobile devices
- Consistent visual hierarchy across all screen sizes
- Prevents UI overflow on small screens

---

## 2. Filter System Integration

### 2.1 Filter State Management
**Files Modified:**
- `frontend/src/App.js`

**Changes:**
- Added `DEFAULT_FILTERS` constant with all filter options set to `false` by default
- Implemented filter state derivation: `showBusStops` and `showTrainStations`
- Filters now properly control map marker visibility

**Filter Options:**
```javascript
{
  onMap: {
    showBusStops: false,
    showTrainStations: false,
    showTrafficConditions: false
  },
  direction: {
    includeWalking: false,
    includeBusses: false,
    includeTrains: false
  }
}
```

### 2.2 Map Marker Visibility Control
**Files Modified:**
- `frontend/src/components/MapView.js`

**Functionality:**
- Bus stop markers only render when `Show Bus Stops` filter is enabled
- Train station markers only render when `Show Train Stations` filter is enabled
- Prevents clutter by hiding markers when not needed
- Improves map performance by reducing rendered elements

---

## 3. Bus Stop Information Display

### 3.1 Clickable Bus Stop Markers
**Files Modified:**
- `frontend/src/components/MapView.js`
- `frontend/src/components/MapView.css`
- `frontend/src/services/api.js`

**Features:**
- Users can click on bus stop nodes to view route information
- Displays all bus routes that stop at the selected location
- Shows route number, operator name, and stop count
- Visual feedback on hover (icon scales to 1.2x)

**Backend Integration:**
- New API endpoint: `GET /api/stops/:atcoCode/routes`
- Returns stop details and all associated bus routes
- Fetches full route information including stop sequences

**Files Modified (Backend):**
- `backend/routes/stops.js`
- `backend/server.js`

---

## 4. Train Station Live Departure Information

### 4.1 Real-Time Train Times
**Files Modified:**
- `frontend/src/components/MapView.js`
- `frontend/src/components/MapView.css`

**Features:**
- Click on train station markers to see upcoming trains
- Shows only trains departing within the next 60 minutes
- Displays destination and time until departure (e.g., "Towards Manchester Airport - 10 min")
- "Due now" indicator for imminent departures
- Automatically filters out past/distant services

**Implementation:**
```javascript
- Time parsing and countdown calculation
- Filters services by: mins !== null && mins <= 60
- Sorts by departure time (earliest first)
- Shows up to 5 upcoming services
```

---

## 5. Enhanced Transfer Information

### 5.1 Detailed Changeover Instructions
**Files Modified:**
- `frontend/src/components/RouteResults.js`
- `frontend/src/components/RouteResults.css`
- `frontend/src/components/MapView.js`

**Features:**
- Transfer steps now show:
  - "Get off [Service Name]"
  - Wait time and next departure time
  - "Board [Next Service Name]"
- Displays in both route details panel and map popups
- Provides clear, step-by-step instructions for connections

**Example:**
```
🛑 Get off Bus 41 at 14:35 at Preston Bus Station
⏳ Wait 8 min · next departs 14:43
🚌 Board Bus 68 from Preston Bus Station
```

---

## 6. Bus Stop Icon Enhancement

### 6.1 Improved Marker Visibility
**Files Modified:**
- `frontend/src/components/MapView.js`
- `frontend/src/components/MapView.css`

**Changes:**
- Increased icon size from 24x24 to 30x30 pixels
- Adjusted anchor point to keep markers centered on nodes
- Better clickability and visibility on map

---

## 7. Bottom Controls Dashboard Responsiveness

### 7.1 Adaptive Button Layout
**Files Modified:**
- `frontend/src/components/BottomControls.css`

**Features:**
- Buttons now wrap and shrink on smaller screens
- Flex-based layout prevents overflow
- 2-column grid on very small screens (≤480px)
- Button labels resize and can wrap when needed
- Maintains usability across all device sizes

---

## 8. Files Added/Modified Summary

### Backend Files:
1. `backend/routes/stops.js` - Added bus route lookup endpoint
2. `backend/server.js` - Added bus route lookup endpoint

### Frontend Files:
1. `frontend/src/App.js` - Filter state management
2. `frontend/src/App.css` - Viewport-responsive sizing
3. `frontend/src/components/MapView.js` - Bus/train markers and live data
4. `frontend/src/components/MapView.css` - Marker and popup styling
5. `frontend/src/components/BottomControls.css` - Responsive controls
6. `frontend/src/components/FilterPage.css` - Responsive filter page
7. `frontend/src/components/SearchBar.css` - Responsive search inputs
8. `frontend/src/components/RouteResults.js` - Transfer instruction enhancements
9. `frontend/src/components/RouteResults.css` - Transfer box styling
10. `frontend/src/services/api.js` - New API functions

---

## 9. Testing Recommendations

### User Acceptance Testing:
1. **Responsive Design:**
   - Test on screens from 320px to 1920px width
   - Verify controls shrink/grow appropriately
   - Check button visibility and clickability

2. **Filter Functionality:**
   - Toggle "Show Bus Stops" on/off
   - Toggle "Show Train Stations" on/off
   - Verify markers appear/disappear correctly

3. **Bus Stop Information:**
   - Click various bus stops
   - Verify route information displays
   - Test with stops that have multiple routes

4. **Train Station Times:**
   - Click train stations
   - Verify only next-hour departures show
   - Check "Due now" and minute countdown accuracy

5. **Transfer Instructions:**
   - Generate multi-leg journeys
   - Verify transfer steps show clear instructions
   - Check both route panel and map popups

---

## 10. Future Enhancements

Potential improvements for future iterations:
- Add real-time bus arrival predictions at stops
- Show platform information for trains
- Display service disruption alerts
- Add favorite stops feature
- Implement stop search functionality
- Show stop accessibility information

---

## 11. Rail Departures Reliability Update (9 March 2026)

### 11.1 Local Timetable Fallback for Train Station Popups
**Files Modified:**
- `backend/server.js`

**Problem:**
- Clicking a train station marker could show no departures when the external live feed was unavailable, timed out, or returned no service entries.

**Changes:**
- Updated `GET /api/rail/departures/:crs` to fallback to local database timetable data when:
   - external live call fails,
   - external response times out,
   - XML parsing fails, or
   - live feed returns zero services.
- Added optional `time` and `day` query parameters for rail departures requests so station popup departures can follow the user-selected planner time.
- Added local lookup from `national_rail`, `schedule_points`, `rail_schedule`, `operators`, and `stops`.
- Returned local services in the same frontend-compatible shape (`services[]`, `destination`, `scheduledDeparture`, `boardingStation`, etc.).
- Normalized local departure times to `HH:MM` format so existing “next 60 min” filtering works in map popups.
- Updated frontend map station requests to pass selected time/day, and popup countdown filtering now uses the selected time reference instead of always using current clock time.

**Result:**
- Train station map popups now continue to show departures using local timetable data when live external data is missing.
- Invalid CRS requests now return a safe empty local response with metadata instead of failing.

---

## 12. Live Bus Icon Destination Display

### 12.1 Bus Direction Indicator on Map Icons
**Files Modified:**
- `frontend/src/components/MapView.js`
- `frontend/src/components/MapView.css`

**Changes:**
- Enhanced `liveBusIcon()` function to accept optional `destination` parameter
- Modified live bus marker icons to display route number and destination (e.g., "100" + "Bus Station")
- Destination names are automatically truncated to 12 characters with ellipsis (`…`) if longer
- Updated marker sizing: icons with destination expand from 36×36px to 50×48px to accommodate two-line layout
- Added `.live-bus-destination` CSS class with small 8px font for destination label
- Icon layout now uses `flex-direction: column` with 1px gap between route number and destination

**Styling Details:**
- Destination text uses same orange (#FF9800) background as route number
- Font is smaller (8px) but still readable with adequate weight (600)
- Text is centered and white with slight opacity (0.95) for depth
- Responsive sizing ensures icons don't overlap on map

**User Benefits:**
- Users can immediately see where each bus is heading without clicking
- Quicker journey planning when scanning multiple live vehicles on map
- Especially useful for routes with multiple destinations (e.g., 100 to Bus Station vs 100 to City Centre)

**Technical Details:**
```javascript
// Example: Bus route 100 to Bus Station Station
icon={liveBusIcon(vehicle.lineName, vehicle.bearing, vehicle.destinationName)}
// Renders: Icon with "100" and "Bus Station" (truncated if needed)
```

---

## Developer Notes

- All filter state defaults to `false` to avoid cluttering the map
- Bus/train markers fetch data on map movement for efficiency
- API calls are debounced via map's `moveend` event
- Error handling implemented for all API calls
- Responsive design uses mobile-first approach
- No breaking changes to existing functionality
- Live bus icons now display both route number and destination for better UX
- Destination text is truncated at 12 characters to maintain icon size consistency

---

## 13. Generic Bus Stop Name Disambiguation

**Problem:** Many bus route destinations and origins displayed as just "Bus Station", "Railway Station", etc., making it impossible to know which town they referred to. The `stops` table has no locality column.

**Solution:** Added a coordinate-based nearest-town resolver in the backend.

**Files Changed:**
- `backend/server.js`

**Implementation:**
- Added `KNOWN_TOWNS` array with 30+ Lancashire/surrounding area town centre coordinates
- Added `GENERIC_STOP_NAMES` set containing names that need qualification ("Bus Station", "Railway Station", "Square", "Hospital", etc.)
- Added `qualifyGenericStopName(name, lat, lon)` function that finds the nearest town and prefixes generic names (e.g. "Bus Station" → "Lancaster Bus Station")
- Updated `GET /api/stops/:atcoCode/routes` to fetch origin/destination coordinates and apply `qualifyGenericStopName()` to both
- Result: 86 "Bus Station" entries now correctly show as "Lancaster Bus Station", "Preston Bus Station", "Chorley Bus Station", etc.

---

## 14. Train Station Popup CRS Code Fix

**Problem:** Clicking on train station markers showed "No trains within the next hour" because the CRS code was missing from the API response, preventing the frontend from fetching departures.

**Root Cause:** The `GET /api/stops/nearby` endpoint queried `nr.crs_code` from the `national_rail` table but omitted it from the response object mapping.

**Files Changed:**
- `backend/server.js`

**Fix:**
- Added `crs_code: r.crs_code` to the rail stop response mapping in the nearby stops endpoint
- CRS codes (e.g. "LAN" for Lancaster, "BAR" for Bare Lane) are now correctly passed to the frontend
- Frontend can now call `fetchRailDepartures(station.crs_code)` successfully
- Live and fallback departures display correctly in station popups

---

**End of Documentation**
