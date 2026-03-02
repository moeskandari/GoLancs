/**
 * Road Variable Message Signs (VMS) route.
 *
 *   GET /api/road/vms — live road message signs from Lancashire
 */

const { Router } = require('express');
const xml2js = require('xml2js');

const router = Router();

router.get('/api/road/vms', async (req, res) => {
  try {
    const response = await fetch('https://scc.transport.lancs.ac.uk/road/vms');
    const xmlText = await response.text();
    const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
    const result = await parser.parseStringPromise(xmlText);

    let signs = [];
    try {
      const vmsTable = result?.['d2LogicalModel']?.['payloadPublication']?.['vmsUnitTable']?.['vmsUnitRecord'];
      if (vmsTable) {
        const records = Array.isArray(vmsTable) ? vmsTable : [vmsTable];
        for (const record of records) {
          const vmsRecord = record?.['vmsRecord'] || record;
          const location = vmsRecord?.['vmsLocation']?.['pointByCoordinates']?.['pointCoordinates'] || {};
          const lat = parseFloat(location?.['latitude'] || 0);
          const lon = parseFloat(location?.['longitude'] || 0);

          // Only include signs in Lancashire area
          if (lat < 53.5 || lat > 54.2 || lon < -3.1 || lon > -2.4) continue;

          const messages = [];
          const textDisplay = vmsRecord?.['vms']?.['textDisplay'] || vmsRecord?.['textDisplay'];
          if (textDisplay) {
            const displays = Array.isArray(textDisplay) ? textDisplay : [textDisplay];
            for (const display of displays) {
              const textPage = display?.['textPage'];
              if (textPage) {
                const pages = Array.isArray(textPage) ? textPage : [textPage];
                for (const page of pages) {
                  const textLine = page?.['vmsText']?.['vmsTextLine'];
                  if (textLine) {
                    const lines = Array.isArray(textLine) ? textLine : [textLine];
                    for (const line of lines) {
                      const text = line?.['vmsTextLine'] || line?._ || (typeof line === 'string' ? line : null);
                      if (text) messages.push(text);
                    }
                  }
                }
              }
            }
          }

          signs.push({
            id: record?.$?.id || vmsRecord?.$?.id || `vms-${signs.length}`,
            location: { lat, lon },
            messages,
            description: vmsRecord?.['vmsDescription']?._ || vmsRecord?.['vmsDescription'] || null,
            status: vmsRecord?.['vmsStatus'] || null
          });
        }
      }
    } catch (parseErr) {
      console.warn('VMS parsing issue:', parseErr.message);
    }

    res.json({ signs, count: signs.length, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('VMS error:', err.message);
    res.status(500).json({ error: 'Failed to fetch VMS data' });
  }
});

module.exports = router;
