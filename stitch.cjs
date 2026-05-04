const fs = require('fs');

const data = JSON.parse(fs.readFileSync('miami_osm.json', 'utf8'));

let ways = [];

data.elements.forEach(el => {
  if (el.type === 'relation' && el.members) {
    el.members.forEach(mem => {
      if (mem.type === 'way' && mem.geometry) {
        ways.push({ id: mem.ref, geometry: mem.geometry });
      }
    });
  } else if (el.type === 'way' && el.geometry) {
    ways.push(el);
  }
});

console.log(`Found ${ways.length} ways in the OSM data`);

if (ways.length === 0) process.exit(1);

let wayPoints = {};
ways.forEach(w => {
  wayPoints[w.id] = w.geometry.map(p => ({ lon: p.lon, lat: p.lat }));
});

let startWay = ways[0];
let currentPath = [...wayPoints[startWay.id]];
let usedWays = new Set([startWay.id]);

function getEndpoints(path) { return [path[0], path[path.length - 1]]; }
function dist2(p1, p2) { return Math.pow(p1.lon - p2.lon, 2) + Math.pow(p1.lat - p2.lat, 2); }

let added = true;
while (added && usedWays.size < ways.length) {
  added = false;
  let ends = getEndpoints(currentPath);
  let head = ends[0], tail = ends[1];
  
  for (const w of ways) {
    if (usedWays.has(w.id)) continue;
    let wPath = wayPoints[w.id];
    let wHead = wPath[0], wTail = wPath[wPath.length - 1];
    let threshold = 0.0000001; 
    
    if (dist2(tail, wHead) < threshold) {
      currentPath = currentPath.concat(wPath.slice(1));
      usedWays.add(w.id); added = true; break;
    } else if (dist2(tail, wTail) < threshold) {
      currentPath = currentPath.concat([...wPath].reverse().slice(1));
      usedWays.add(w.id); added = true; break;
    } else if (dist2(head, wTail) < threshold) {
      currentPath = wPath.slice(0, -1).concat(currentPath);
      usedWays.add(w.id); added = true; break;
    } else if (dist2(head, wHead) < threshold) {
      currentPath = [...wPath].reverse().slice(0, -1).concat(currentPath);
      usedWays.add(w.id); added = true; break;
    }
  }
  
  if (!added && usedWays.size < ways.length) {
    let closestWay = null, closestDist = Infinity, action = '';
    for (const w of ways) {
      if (usedWays.has(w.id)) continue;
      let wPath = wayPoints[w.id];
      let wHead = wPath[0], wTail = wPath[wPath.length - 1];
      
      let d1 = dist2(tail, wHead); if (d1 < closestDist) { closestDist = d1; closestWay = w; action = 'tail-head'; }
      let d2 = dist2(tail, wTail); if (d2 < closestDist) { closestDist = d2; closestWay = w; action = 'tail-tail'; }
      let d3 = dist2(head, wTail); if (d3 < closestDist) { closestDist = d3; closestWay = w; action = 'head-tail'; }
      let d4 = dist2(head, wHead); if (d4 < closestDist) { closestDist = d4; closestWay = w; action = 'head-head'; }
    }
    
    if (closestDist < 0.00001) {
      let wPath = wayPoints[closestWay.id];
      if (action === 'tail-head') currentPath = currentPath.concat(wPath);
      else if (action === 'tail-tail') currentPath = currentPath.concat([...wPath].reverse());
      else if (action === 'head-tail') currentPath = wPath.concat(currentPath);
      else if (action === 'head-head') currentPath = [...wPath].reverse().concat(currentPath);
      usedWays.add(closestWay.id); added = true;
    }
  }
}

console.log(`Used ${usedWays.size}/${ways.length} ways. Total points: ${currentPath.length}`);

// Force close the loop
if (dist2(currentPath[0], currentPath[currentPath.length - 1]) > 0) {
   currentPath.push(currentPath[0]);
}

const out = currentPath.map(p => `[${p.lon}, ${p.lat}]`).join(', ');
fs.writeFileSync('miamiFull.js', `[\n  ${out}\n]`);
