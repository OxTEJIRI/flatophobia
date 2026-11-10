// Projects Natural Earth land (world-atlas, public domain) onto the classic "flat earth" map:
// an azimuthal equidistant projection centred on the North Pole. r = (90 - lat) / 180, so the
// pole is the centre and Antarctica stretches into the ice wall around the rim.
// Output: web/data/land.json = [[x0,y0,x1,y1,...], ...] in the unit disc, y pointing down (Greenwich at the bottom).
const fs = require("fs");
const path = require("path");
const topojson = require(path.join(__dirname, "dl", "topojson-client.js"));

const topo = JSON.parse(fs.readFileSync(path.join(__dirname, "dl", "land-50m.json"), "utf8"));
const land = topojson.feature(topo, topo.objects.land);

const rad = Math.PI / 180;
function project([lon, lat]) {
  const r = (90 - lat) / 180;
  return [r * Math.sin(lon * rad), r * Math.cos(lon * rad)];
}

const out = [];
let points = 0;
const polys = land.geometry ? (land.geometry.type === "MultiPolygon" ? land.geometry.coordinates : [land.geometry.coordinates]) : land.features.flatMap((f) => (f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates]));
for (const poly of polys) {
  for (const ring of poly) {
    const flat = [];
    let px = 9, py = 9;
    for (const c of ring) {
      const [x, y] = project(c);
      if (Math.hypot(x - px, y - py) < 0.0016) continue;
      flat.push(+x.toFixed(4), +y.toFixed(4));
      px = x; py = y;
    }
    if (flat.length >= 8) { out.push(flat); points += flat.length / 2; }
  }
}
fs.writeFileSync(path.join(__dirname, "..", "web", "data", "land.json"), JSON.stringify(out));
console.log(`rings=${out.length} points=${points} bytes=${fs.statSync(path.join(__dirname, "..", "web", "data", "land.json")).size}`);
