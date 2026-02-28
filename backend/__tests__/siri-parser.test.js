/**
 * Tests for SIRI VehicleMonitoringDelivery XML parser.
 * Validates parseSiriVehicles handles valid, empty, and malformed XML.
 */

const app = require('../server');
const { parseSiriVehicles } = app._test;

// ── Sample SIRI XML payloads ───────────────────────────────

const VALID_SIRI_XML = `<?xml version="1.0" encoding="utf-8"?>
<Siri xmlns="http://www.siri.org.uk/siri">
  <ServiceDelivery>
    <VehicleMonitoringDelivery>
      <VehicleActivity>
        <RecordedAtTime>2025-01-15T10:30:00Z</RecordedAtTime>
        <ValidUntilTime>2025-01-15T10:35:00Z</ValidUntilTime>
        <MonitoredVehicleJourney>
          <VehicleRef>SCCU-1234</VehicleRef>
          <LineRef>100</LineRef>
          <PublishedLineName>100</PublishedLineName>
          <OperatorRef>SCCU</OperatorRef>
          <DirectionRef>outbound</DirectionRef>
          <OriginRef>2500LAA12345</OriginRef>
          <OriginName>Lancaster_Bus_Station</OriginName>
          <DestinationRef>2500LAA67890</DestinationRef>
          <DestinationName>Preston_Bus_Station</DestinationName>
          <OriginAimedDepartureTime>2025-01-15T10:00:00Z</OriginAimedDepartureTime>
          <DestinationAimedArrivalTime>2025-01-15T11:00:00Z</DestinationAimedArrivalTime>
          <VehicleLocation>
            <Latitude>54.0488</Latitude>
            <Longitude>-2.8079</Longitude>
          </VehicleLocation>
          <Bearing>180</Bearing>
        </MonitoredVehicleJourney>
        <Extensions>
          <VehicleJourney>
            <VehicleUniqueId>SCCU-BUS-42</VehicleUniqueId>
            <Operational>
              <TicketMachine>
                <JourneyCode>J100-42</JourneyCode>
              </TicketMachine>
            </Operational>
          </VehicleJourney>
        </Extensions>
      </VehicleActivity>
    </VehicleMonitoringDelivery>
  </ServiceDelivery>
</Siri>`;

const MULTI_VEHICLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<Siri xmlns="http://www.siri.org.uk/siri">
  <ServiceDelivery>
    <VehicleMonitoringDelivery>
      <VehicleActivity>
        <RecordedAtTime>2025-01-15T10:30:00Z</RecordedAtTime>
        <MonitoredVehicleJourney>
          <VehicleRef>BUS-1</VehicleRef>
          <LineRef>100</LineRef>
          <PublishedLineName>100</PublishedLineName>
          <OperatorRef>SCCU</OperatorRef>
          <DirectionRef>outbound</DirectionRef>
          <VehicleLocation>
            <Latitude>54.0488</Latitude>
            <Longitude>-2.8079</Longitude>
          </VehicleLocation>
        </MonitoredVehicleJourney>
      </VehicleActivity>
      <VehicleActivity>
        <RecordedAtTime>2025-01-15T10:31:00Z</RecordedAtTime>
        <MonitoredVehicleJourney>
          <VehicleRef>BUS-2</VehicleRef>
          <LineRef>2</LineRef>
          <PublishedLineName>2</PublishedLineName>
          <OperatorRef>ARCT</OperatorRef>
          <DirectionRef>inbound</DirectionRef>
          <VehicleLocation>
            <Latitude>53.7553</Latitude>
            <Longitude>-2.7072</Longitude>
          </VehicleLocation>
        </MonitoredVehicleJourney>
      </VehicleActivity>
      <VehicleActivity>
        <RecordedAtTime>2025-01-15T10:32:00Z</RecordedAtTime>
        <MonitoredVehicleJourney>
          <VehicleRef>BUS-3</VehicleRef>
          <LineRef>X1</LineRef>
          <VehicleLocation>
          </VehicleLocation>
        </MonitoredVehicleJourney>
      </VehicleActivity>
    </VehicleMonitoringDelivery>
  </ServiceDelivery>
</Siri>`;

const EMPTY_DELIVERY_XML = `<?xml version="1.0" encoding="utf-8"?>
<Siri xmlns="http://www.siri.org.uk/siri">
  <ServiceDelivery>
    <VehicleMonitoringDelivery>
    </VehicleMonitoringDelivery>
  </ServiceDelivery>
</Siri>`;

const NO_DELIVERY_XML = `<?xml version="1.0" encoding="utf-8"?>
<Siri xmlns="http://www.siri.org.uk/siri">
  <ServiceDelivery>
  </ServiceDelivery>
</Siri>`;

const SINGLE_VEHICLE_NO_ARRAY_XML = `<?xml version="1.0" encoding="utf-8"?>
<Siri xmlns="http://www.siri.org.uk/siri">
  <ServiceDelivery>
    <VehicleMonitoringDelivery>
      <VehicleActivity>
        <RecordedAtTime>2025-01-15T10:30:00Z</RecordedAtTime>
        <MonitoredVehicleJourney>
          <VehicleRef>SOLO-1</VehicleRef>
          <LineRef>X1</LineRef>
          <OperatorRef>SCNW</OperatorRef>
          <VehicleLocation>
            <Latitude>54.1000</Latitude>
            <Longitude>-2.9000</Longitude>
          </VehicleLocation>
        </MonitoredVehicleJourney>
      </VehicleActivity>
    </VehicleMonitoringDelivery>
  </ServiceDelivery>
</Siri>`;

// ── Tests ──────────────────────────────────────────────────

describe('parseSiriVehicles', () => {
  it('should parse a single vehicle with all fields', async () => {
    const vehicles = await parseSiriVehicles(VALID_SIRI_XML);
    expect(vehicles).toHaveLength(1);

    const v = vehicles[0];
    expect(v.vehicleRef).toBe('SCCU-1234');
    expect(v.vehicleId).toBe('SCCU-BUS-42');
    expect(v.lineRef).toBe('100');
    expect(v.lineName).toBe('100');
    expect(v.operatorRef).toBe('SCCU');
    expect(v.directionRef).toBe('outbound');
    expect(v.originRef).toBe('2500LAA12345');
    expect(v.originName).toBe('Lancaster Bus Station');
    expect(v.destinationRef).toBe('2500LAA67890');
    expect(v.destinationName).toBe('Preston Bus Station');
    expect(v.latitude).toBeCloseTo(54.0488, 4);
    expect(v.longitude).toBeCloseTo(-2.8079, 4);
    expect(v.bearing).toBe(180);
    expect(v.recordedAt).toBe('2025-01-15T10:30:00Z');
    expect(v.validUntil).toBe('2025-01-15T10:35:00Z');
    expect(v.journeyCode).toBe('J100-42');
    expect(v.aimedDeparture).toBe('2025-01-15T10:00:00Z');
    expect(v.aimedArrival).toBe('2025-01-15T11:00:00Z');
  });

  it('should replace underscores in origin/destination names', async () => {
    const vehicles = await parseSiriVehicles(VALID_SIRI_XML);
    expect(vehicles[0].originName).not.toContain('_');
    expect(vehicles[0].destinationName).not.toContain('_');
  });

  it('should parse multiple vehicles', async () => {
    const vehicles = await parseSiriVehicles(MULTI_VEHICLE_XML);
    // BUS-3 has empty VehicleLocation so should be filtered out
    expect(vehicles).toHaveLength(2);
    expect(vehicles[0].vehicleRef).toBe('BUS-1');
    expect(vehicles[1].vehicleRef).toBe('BUS-2');
  });

  it('should filter out vehicles without coordinates', async () => {
    const vehicles = await parseSiriVehicles(MULTI_VEHICLE_XML);
    vehicles.forEach(v => {
      expect(v.latitude).not.toBeNull();
      expect(v.longitude).not.toBeNull();
    });
  });

  it('should handle a single vehicle (non-array) response', async () => {
    const vehicles = await parseSiriVehicles(SINGLE_VEHICLE_NO_ARRAY_XML);
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].vehicleRef).toBe('SOLO-1');
    expect(vehicles[0].lineRef).toBe('X1');
    expect(vehicles[0].operatorRef).toBe('SCNW');
  });

  it('should return empty array for empty delivery', async () => {
    const vehicles = await parseSiriVehicles(EMPTY_DELIVERY_XML);
    expect(vehicles).toEqual([]);
  });

  it('should return empty array when no delivery element exists', async () => {
    const vehicles = await parseSiriVehicles(NO_DELIVERY_XML);
    expect(vehicles).toEqual([]);
  });

  it('should reject malformed XML', async () => {
    await expect(parseSiriVehicles('<not valid xml<<<'))
      .rejects.toThrow();
  });

  it('should parse coordinates as numbers', async () => {
    const vehicles = await parseSiriVehicles(VALID_SIRI_XML);
    expect(typeof vehicles[0].latitude).toBe('number');
    expect(typeof vehicles[0].longitude).toBe('number');
    expect(typeof vehicles[0].bearing).toBe('number');
  });

  it('should handle missing optional fields gracefully', async () => {
    const vehicles = await parseSiriVehicles(MULTI_VEHICLE_XML);
    const bus2 = vehicles[1]; // BUS-2 has no Extensions
    expect(bus2.vehicleId).toBe('BUS-2'); // falls back to VehicleRef
    expect(bus2.journeyCode).toBeNull();
    expect(bus2.bearing).toBeNull();
  });
});
