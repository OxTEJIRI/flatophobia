// Real places on the flat map, so every cell has a name ("ring 3 · near lagos").
import { cellCenter, CELLS } from "./rules.js";

const PLACES = [
  // the north
  ["reykjavik", 64.1, -21.9], ["oslo", 59.9, 10.7], ["moscow", 55.8, 37.6], ["london", 51.5, -0.1], ["paris", 48.9, 2.4],
  ["berlin", 52.5, 13.4], ["kyiv", 50.4, 30.5], ["helsinki", 60.2, 24.9], ["anchorage", 61.2, -149.9], ["vancouver", 49.3, -123.1],
  ["toronto", 43.7, -79.4], ["montreal", 45.5, -73.6], ["chicago", 41.9, -87.6], ["seattle", 47.6, -122.3], ["novosibirsk", 55.0, 82.9],
  ["yakutsk", 62.0, 129.7], ["vladivostok", 43.1, 131.9], ["sapporo", 43.1, 141.4], ["ulaanbaatar", 47.9, 106.9], ["astana", 51.2, 71.4],
  ["nuuk", 64.2, -51.7], ["murmansk", 69.0, 33.1], ["winnipeg", 49.9, -97.1], ["magadan", 59.6, 150.8], ["norilsk", 69.3, 88.2],
  // the tropics
  ["new york", 40.7, -74.0], ["los angeles", 34.0, -118.2], ["mexico city", 19.4, -99.1], ["miami", 25.8, -80.2], ["havana", 23.1, -82.4],
  ["madrid", 40.4, -3.7], ["rome", 41.9, 12.5], ["istanbul", 41.0, 29.0], ["cairo", 30.0, 31.2], ["dakar", 14.7, -17.4],
  ["riyadh", 24.7, 46.7], ["dubai", 25.2, 55.3], ["tehran", 35.7, 51.4], ["karachi", 24.9, 67.0], ["delhi", 28.6, 77.2],
  ["mumbai", 19.1, 72.9], ["dhaka", 23.8, 90.4], ["bangkok", 13.8, 100.5], ["hong kong", 22.3, 114.2], ["shanghai", 31.2, 121.5],
  ["beijing", 39.9, 116.4], ["seoul", 37.6, 127.0], ["tokyo", 35.7, 139.7], ["manila", 14.6, 121.0], ["honolulu", 21.3, -157.9],
  ["khartoum", 15.6, 32.5], ["casablanca", 33.6, -7.6], ["baghdad", 33.3, 44.4], ["hanoi", 21.0, 105.8], ["caracas", 10.5, -66.9],
  ["san juan", 18.5, -66.1], ["guam", 13.4, 144.8], ["midway", 28.2, -177.4], ["bamako", 12.6, -8.0], ["kano", 12.0, 8.5],
  // the equator
  ["lagos", 6.5, 3.4], ["accra", 5.6, -0.2], ["abidjan", 5.3, -4.0], ["nairobi", -1.3, 36.8], ["kinshasa", -4.3, 15.3],
  ["luanda", -8.8, 13.2], ["dar es salaam", -6.8, 39.3], ["singapore", 1.35, 103.8], ["jakarta", -6.2, 106.8], ["bogota", 4.7, -74.1],
  ["lima", -12.0, -77.0], ["quito", -0.2, -78.5], ["manaus", -3.1, -60.0], ["salvador", -13.0, -38.5], ["brasilia", -15.8, -47.9],
  ["lusaka", -15.4, 28.3], ["harare", -17.8, 31.0], ["darwin", -12.5, 130.8], ["port moresby", -9.4, 147.2], ["suva", -18.1, 178.4],
  ["tahiti", -17.5, -149.6], ["colombo", 6.9, 79.9], ["antananarivo", -18.9, 47.5], ["mogadishu", 2.0, 45.3], ["male", 4.2, 73.5],
  ["bali", -8.7, 115.2], ["kampala", 0.35, 32.6], ["douala", 4.0, 9.7], ["galapagos", -0.9, -89.6], ["samoa", -13.8, -171.8],
  ["kiribati", 1.9, -157.4], ["mauritius", -20.2, 57.5], ["recife", -8.05, -34.9], ["ascension", -7.9, -14.4], ["solomon islands", -9.4, 160.0],
  // the south seas
  ["johannesburg", -26.2, 28.0], ["cape town", -33.9, 18.4], ["durban", -29.9, 31.0], ["sao paulo", -23.6, -46.6], ["buenos aires", -34.6, -58.4],
  ["santiago", -33.4, -70.7], ["montevideo", -34.9, -56.2], ["sydney", -33.9, 151.2], ["melbourne", -37.8, 145.0], ["perth", -31.95, 115.9],
  ["adelaide", -34.9, 138.6], ["auckland", -36.8, 174.8], ["wellington", -41.3, 174.8], ["hobart", -42.9, 147.3], ["punta arenas", -53.2, -70.9],
  ["stanley", -51.7, -57.9], ["kerguelen", -49.3, 70.2], ["christchurch", -43.5, 172.6], ["brisbane", -27.5, 153.0], ["tristan da cunha", -37.1, -12.3],
  ["easter island", -27.1, -109.4], ["ushuaia", -54.8, -68.3], ["south georgia", -54.3, -36.5], ["bouvet island", -54.4, 3.4], ["macquarie island", -54.5, 158.9],
  ["pitcairn", -25.1, -130.1], ["chatham islands", -44.0, -176.5], ["heard island", -53.1, 73.5], ["crozet", -46.4, 51.8], ["amsterdam island", -37.8, 77.6],
  // the ice wall
  ["palmer station", -64.8, -64.1], ["rothera", -67.6, -68.1], ["halley", -75.6, -26.2], ["troll", -72.0, 2.5], ["novolazarevskaya", -70.8, 11.8],
  ["syowa", -69.0, 39.6], ["mawson", -67.6, 62.9], ["davis", -68.6, 78.0], ["vostok", -78.5, 106.8], ["casey", -66.3, 110.5],
  ["dumont d'urville", -66.7, 140.0], ["mcmurdo", -77.8, 166.7], ["the ross sea", -75.0, -175.0], ["the weddell sea", -72.0, -45.0], ["the amundsen sea", -72.0, -112.0],
  ["the bellingshausen sea", -71.0, -85.0], ["the scotia sea", -57.0, -40.0], ["the drake passage", -58.0, -65.0], ["byrd station", -80.0, -119.5], ["russkaya", -74.8, -136.9],
];

const rad = Math.PI / 180;
// board coordinates: x right, y up; the map has Greenwich at the bottom
const projected = PLACES.map(([name, lat, lon]) => {
  const r = (90 - lat) / 180;
  return [name, r * Math.sin(lon * rad), -r * Math.cos(lon * rad)];
});

const nearest = [];
for (let c = 0; c < CELLS; c++) {
  const [x, y] = cellCenter(c);
  let best = null, bd = Infinity;
  for (const [name, px, py] of projected) {
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bd) { bd = d; best = name; }
  }
  nearest.push(best);
}

export const placeNear = (cell) => nearest[cell] || "the open sea";
