/**
 * Railway graph utilities for track-following geometry.
 *
 * Loads the adjacency graph from data/railway_graph.json and provides:
 *   railGraph           – the loaded graph object
 *   findNearestRailNode – snap a lat/lon to the nearest graph node
 *   findRailTrackPath   – Dijkstra shortest path between two points
 *
 * Used by the geometry service to draw accurate rail lines on the map.
 */

const fs = require('fs');
const path = require('path');
const { haversineDistance } = require('./geo');

// ── Load railway graph ──────────────────────────────────────────────
let railGraph = {};
try {
  const graphPath = path.join(__dirname, '..', 'data', 'railway_graph.json');
  railGraph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  console.log(`Railway graph loaded: ${Object.keys(railGraph).length} nodes`);
} catch (err) {
  console.warn('Railway graph not available:', err.message);
}

/**
 * Find the nearest node in the rail graph to a given lat/lon.
 * Returns { id, lat, lon, distance } or null.
 */
function findNearestRailNode(lat, lon) {
  let nearest = null;
  let minDist = Infinity;
  for (const [id, node] of Object.entries(railGraph)) {
    const d = haversineDistance(lat, lon, node.lat, node.lon);
    if (d < minDist) {
      minDist = d;
      nearest = { id, lat: node.lat, lon: node.lon, distance: d };
    }
  }
  return nearest;
}

/**
 * Find the shortest rail-track path between two points using Dijkstra's algorithm.
 * Returns an array of [lat, lon] pairs following the rail graph,
 * or null if no path exists (or the graph is empty).
 *
 * maxDistance (km, default 5): snapping radius for start/end points.
 */
function findRailTrackPath(fromLat, fromLon, toLat, toLon, maxDistance = 5) {
  if (Object.keys(railGraph).length === 0) return null;

  const startNode = findNearestRailNode(fromLat, fromLon);
  const endNode = findNearestRailNode(toLat, toLon);
  if (!startNode || !endNode) return null;
  if (startNode.distance > maxDistance || endNode.distance > maxDistance) return null;
  if (startNode.id === endNode.id) {
    return [[railGraph[startNode.id].lat, railGraph[startNode.id].lon]];
  }

  // Dijkstra
  const dist = {};
  const prev = {};
  const visited = new Set();
  const queue = []; // simple priority queue via sorted insertions

  dist[startNode.id] = 0;
  queue.push({ id: startNode.id, d: 0 });

  while (queue.length > 0) {
    queue.sort((a, b) => a.d - b.d);
    const { id: current } = queue.shift();

    if (current === endNode.id) break;
    if (visited.has(current)) continue;
    visited.add(current);

    const node = railGraph[current];
    if (!node || !node.edges) continue;

    for (const edge of node.edges) {
      if (visited.has(edge.to)) continue;
      const newDist = dist[current] + edge.distance;
      if (newDist < (dist[edge.to] ?? Infinity)) {
        dist[edge.to] = newDist;
        prev[edge.to] = current;
        queue.push({ id: edge.to, d: newDist });
      }
    }
  }

  if (dist[endNode.id] === undefined) return null;

  // Reconstruct path
  const pathIds = [];
  let cur = endNode.id;
  while (cur) {
    pathIds.unshift(cur);
    cur = prev[cur];
  }

  return pathIds.map(id => [railGraph[id].lat, railGraph[id].lon]);
}

module.exports = { railGraph, findNearestRailNode, findRailTrackPath };
