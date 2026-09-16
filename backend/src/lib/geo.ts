const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** المسافة بين نقطتين بالأمتار — صيغة Haversine */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a)));
}

/**
 * صندوق إحاطة تقريبي لتصفية أولية في SQL قبل حساب Haversine الدقيق.
 * يقلّل عدد الصفوف المقروءة بشكل كبير ويستفيد من index (latitude, longitude).
 */
export function boundingBox(lat: number, lon: number, radiusKm: number) {
  const latDelta = radiusKm / 111.32;
  const cos = Math.cos(toRad(lat));
  const lonDelta = radiusKm / (111.32 * (Math.abs(cos) < 1e-6 ? 1e-6 : cos));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta,
  };
}

export const metersToKm = (m: number) => Math.round((m / 1000) * 10) / 10;
