const LAT_METRES = 111195;

export function distance(a, b) {
  const scale = Math.cos((a[0] + b[0]) * Math.PI / 360);
  return LAT_METRES * Math.hypot(a[0] - b[0], (a[1] - b[1]) * scale);
}

export function angleDelta(a, b) {
  return Math.abs((a - b + 540) % 360 - 180);
}

function project(point, a, b) {
  const scale = Math.cos(point[0] * Math.PI / 180);
  const x = (b[1] - a[1]) * scale;
  const y = b[0] - a[0];
  const dx = (point[1] - a[1]) * scale;
  const dy = point[0] - a[0];
  const len = x * x + y * y;
  const t = len ? Math.max(0, Math.min(1, (dx * x + dy * y) / len)) : 0;
  return {t, away: LAT_METRES * Math.hypot(dx - t * x, dy - t * y), bearing: (Math.atan2(x, y) * 180 / Math.PI + 360) % 360};
}

function pathSegments(points) {
  let cursor = 0;
  return points.slice(1).map((b, i) => {
    const a = points[i];
    const length = distance(a, b);
    const segment = {a, b, start: cursor, length};
    cursor += length;
    return segment;
  });
}

function match(point, segments, {minimum = 0, maximum = Infinity, heading = null} = {}) {
  let best = null;
  for (const segment of segments) {
    if (segment.start + segment.length < minimum || segment.start > maximum) continue;
    const projection = project(point, segment.a, segment.b);
    const along = segment.start + segment.length * projection.t;
    if (along < minimum || along > maximum) continue;
    const score = projection.away + (heading == null || segment.length < 5 ? 0 : 0.45 * angleDelta(heading, projection.bearing));
    if (!best || score < best.score) best = {...projection, along, score};
  }
  return best;
}

export function makeTrack(stops, shape) {
  const points = stops.map(([, lat, lng]) => [lat, lng]);
  if (shape?.length > 1) {
    const segments = pathSegments(shape);
    const anchors = [];
    let minimum = 0;
    for (const point of points) {
      const fix = match(point, segments, {minimum});
      if (!fix || fix.away > 135) break;
      minimum = fix.along;
      anchors.push(minimum);
    }
    if (anchors.length === points.length && anchors.at(-1) - anchors[0] >= distance(points[0], points.at(-1)) * .9) return {segments, anchors};
  }
  const segments = pathSegments(points);
  const anchors = [0, ...segments.map(({start, length}) => start + length)];
  return {segments, anchors};
}

export function readProgress(track, point, previous, accuracy, heading, ageSeconds) {
  const maximumAway = Math.max(100, accuracy * 2);
  const context = previous == null ? {heading} : {
    minimum: Math.max(0, previous - Math.max(100, accuracy * 2)),
    maximum: previous + Math.max(150, 32 * ageSeconds + accuracy),
    heading
  };
  const best = match(point, track.segments, context);
  const unconstrained = previous == null ? best : match(point, track.segments, {heading});
  if (!best || best.away > maximumAway || (unconstrained && best.score > unconstrained.score + Math.max(65, accuracy))) return null;
  return Math.max(previous ?? 0, best.along);
}

export function stopProgress(anchors, progress, accuracy) {
  if (progress == null) return 0;
  const clearance = Math.max(25, Math.min(accuracy * .75, 65));
  const upcoming = anchors.findIndex(at => at + clearance >= progress);
  return upcoming === -1 ? anchors.length : upcoming;
}

export function rankRoutes(routes, stops, point, heading, maxDistance) {
  const nearby = [];
  for (const route of routes) {
    let best = null;
    for (let i = 1; i < route.ids.length; i++) {
      const a = stops[route.ids[i - 1]].slice(1);
      const b = stops[route.ids[i]].slice(1);
      if (point[0] < Math.min(a[0], b[0]) - .009 || point[0] > Math.max(a[0], b[0]) + .009 ||
          point[1] < Math.min(a[1], b[1]) - .009 || point[1] > Math.max(a[1], b[1]) + .009) continue;
      const fix = project(point, a, b);
      const score = fix.away + (heading == null ? 0 : 1.6 * angleDelta(heading, fix.bearing));
      if (fix.away <= maxDistance && (!best || score < best.score)) best = {...fix, score};
    }
    if (best) nearby.push({route, metres: best.away, score: best.score - Math.min(30, Math.log1p(route.frequency) * 5)});
  }
  return nearby.sort((a, b) => a.score - b.score);
}
