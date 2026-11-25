const paper = '#f2e9d5';
const ink = '#183c35';
const routeColor = '#b63f28';
const labelPaper = '#fff9e8';
const mercator = ([lat, lon]) => [lon, -Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 180 / Math.PI];
const clamp = (value, lo, hi) => Math.max(lo, Math.min(value, hi));
const areas = ['Avadi', 'Ambattur', 'Poonamallee', 'Porur', 'Guindy', 'Alandur', 'Adyar',
  'Thiruvanmiyur', 'Velachery', 'Perungudi', 'Pallavaram', 'Tambaram', 'Pallikaranai',
  'Sholinganallur', 'Medavakkam', 'Navalur', 'Padur', 'Kelambakkam', 'Thiruvottiyur'];

let networkRequest;
function mapBackground() {
  networkRequest ??= fetch('./map-network.json').then(response => {
    if (!response.ok) throw new Error('Map background unavailable');
    return response.json();
  }).then(layers => layers.map(layer => {
    const projected = new Float32Array(layer.length);
    for (let i = 0; i < layer.length; i += 2) {
      const [x, y] = mercator([layer[i] / 5000, layer[i + 1] / 5000]);
      projected[i] = x;
      projected[i + 1] = y;
    }
    return projected;
  })).catch(() => []);
  return networkRequest;
}

function bounds(points) {
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function dot(ctx, x, y, radius, fill, stroke = null, width = 1) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function drawBus(ctx, x, y) {
  // The tip locates the GPS fix while the body stays clear of the stop dot.
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-5, -9);
  ctx.lineTo(0, 0);
  ctx.lineTo(5, -9);
  ctx.fillStyle = ink;
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-13, -34, 26, 27, 6);
  ctx.fillStyle = routeColor;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = labelPaper;
  ctx.stroke();
  ctx.fillStyle = labelPaper;
  ctx.fillRect(-5, -31, 10, 2);
  ctx.fillRect(-10, -17, 20, 2);
  ctx.fillStyle = ink;
  ctx.fillRect(-9, -27, 18, 9);
  ctx.fillStyle = '#b8d3b7';
  ctx.fillRect(-8, -26, 7, 6);
  ctx.fillRect(1, -26, 7, 6);
  ctx.fillStyle = labelPaper;
  ctx.fillRect(-9, -13, 4, 2);
  ctx.fillRect(5, -13, 4, 2);
  ctx.restore();
}

export function createRouteMap(canvas, {inButton, outButton, fitButton}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return {update() {}, setPlaces() {}};
  let background, places = [], routeKey, routePath, routeLine, stopList, extent, current, target;
  let zoom = 1, shiftX = 0, shiftY = 0, drag = null, frame = 0;
  let width, height;

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }

  function reset() {
    zoom = 1;
    shiftX = 0;
    shiftY = 0;
    schedule();
  }

  function magnify(ratio) {
    const before = zoom;
    zoom = clamp(zoom * ratio, .62, 6);
    shiftX *= zoom / before;
    shiftY *= zoom / before;
    schedule();
  }

  function draw() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    if (!width || !height || !extent) return;
    if (!background) {
      background = [];
      mapBackground().then(layers => { background = layers; schedule(); });
    }
    const pixelRatio = Math.min(3, window.devicePixelRatio || 1);
    const bufferWidth = Math.round(width * pixelRatio);
    const bufferHeight = Math.round(height * pixelRatio);
    if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
    }
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, width, height);
    const [west, north, east, south] = extent;
    const baseScale = Math.min((width - 80) / Math.max(.012, east - west), (height - 104) / Math.max(.012, south - north));
    const scale = baseScale * zoom;
    const originX = width / 2 + shiftX - (west + east) / 2 * scale;
    const originY = height / 2 + shiftY - (north + south) / 2 * scale;
    const px = mapX => mapX * scale + originX;
    const py = mapY => mapY * scale + originY;
    const edgeWest = (-12 - originX) / scale, edgeEast = (width + 12 - originX) / scale;
    const edgeNorth = (-12 - originY) / scale, edgeSouth = (height + 12 - originY) / scale;
    const visible = (x, y) => x >= edgeWest && x <= edgeEast && y >= edgeNorth && y <= edgeSouth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const [layerIndex, layer] of background.entries()) {
      ctx.beginPath();
      for (let i = 0; i < layer.length; i += 4) {
        const x1 = layer[i], y1 = layer[i + 1], x2 = layer[i + 2], y2 = layer[i + 3];
        if ((x1 < edgeWest && x2 < edgeWest) || (x1 > edgeEast && x2 > edgeEast) ||
            (y1 < edgeNorth && y2 < edgeNorth) || (y1 > edgeSouth && y2 > edgeSouth)) continue;
        ctx.moveTo(px(x1), py(y1));
        ctx.lineTo(px(x2), py(y2));
      }
      ctx.lineWidth = [.85, 1.45, 2.5][layerIndex];
      ctx.strokeStyle = ['#dbd6be', '#c6c7ad', '#aeb59b'][layerIndex];
      ctx.stroke();
      if (layerIndex) {
        ctx.lineWidth = layerIndex === 2 ? 1.3 : .7;
        ctx.strokeStyle = '#faf5e4';
        ctx.stroke();
      }
    }

    const visited = [];
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [name, [x, y]] of places) {
      const w = ctx.measureText(name).width;
      const left = px(x) - w / 2, top = py(y);
      if (left < 7 || left + w > width - 7 || top < 14 || top > height - 20) continue;
      if (stopList.some(({point}) => Math.abs(px(point[0]) - px(x)) < w / 2 + 10 && Math.abs(py(point[1]) - top) < 11)) continue;
      if (visited.some(([at, line, length]) => Math.abs(line - top) < 16 && at < left + w + 9 && left < at + length + 9)) continue;
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = paper;
      ctx.strokeText(name, px(x), top);
      ctx.fillStyle = '#4a5d4c';
      ctx.fillText(name, px(x), top);
      visited.push([left, top, w]);
    }

    ctx.beginPath();
    for (const [i, [x, y]] of routeLine.entries()) {
      if (i === 0) ctx.moveTo(px(x), py(y));
      else ctx.lineTo(px(x), py(y));
    }
    ctx.strokeStyle = labelPaper;
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = routeColor;
    ctx.lineWidth = 5;
    ctx.stroke();

    let prior = null;
    for (const [index, {point: [x, y]}] of stopList.entries()) {
      if (!visible(x, y) || index === 0 || index === stopList.length - 1 || index === target) continue;
      const screen = [px(x), py(y)];
      if (prior && Math.hypot(screen[0] - prior[0], screen[1] - prior[1]) < 11) continue;
      dot(ctx, ...screen, 2.7, labelPaper, routeColor, 1.25);
      prior = screen;
    }

    const occupied = [];
    if (current) {
      const x = px(current[0]), y = py(current[1]);
      occupied.push({x:x - 16, y:y - 36, w:32, h:38});
    }
    const markers = new Map([[0, 'start'], [stopList.length - 1, 'terminus']]);
    if (target != null) markers.set(target, 'alert');
    for (const [index, type] of markers) {
      const {name, point:[x, y]} = stopList[index];
      if (!visible(x, y)) continue;
      const screenX = px(x), screenY = py(y);
      dot(ctx, screenX, screenY, type === 'alert' ? 7 : 6, type === 'start' ? labelPaper : routeColor, type === 'start' ? routeColor : labelPaper, 2);
      if (screenX < 5 || screenX > width - 5 || screenY < 5 || screenY > height - 5) continue;
      const text = type === 'alert' ? name + ' · Alert' : name;
      ctx.font = '650 12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      const labelWidth = Math.min(Math.ceil(ctx.measureText(text).width) + 19, width * .59);
      const right = screenX + 12, left = screenX - labelWidth - 12;
      const sides = screenX < width / 2 ? [right, left] : [left, right];
      const options = [
        ...sides.map(x => [x, screenY - 13]), [screenX - labelWidth / 2, screenY + 12],
        [screenX - labelWidth / 2, screenY - 39],
      ].map(([x, y]) => ({x:clamp(x, 6, width - labelWidth - 6), y:clamp(y, 6, height - 31), w:labelWidth, h:26}));
      const chosen = options.find(box => occupied.every(other =>
        box.x >= other.x + other.w + 2 || box.x + box.w <= other.x - 2 ||
        box.y >= other.y + other.h + 2 || box.y + box.h <= other.y - 2)) || options[0];
      const {x:boxX, y:boxY} = chosen;
      occupied.push(chosen);
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, labelWidth, 26, 5);
      ctx.fillStyle = labelPaper;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#c5c8b1';
      ctx.stroke();
      ctx.fillStyle = type === 'alert' ? routeColor : ink;
      ctx.fillText(text, boxX + 9, boxY + 13, labelWidth - 18);
    }

    if (current && visible(...current)) {
      const [x, y] = current;
      drawBus(ctx, px(x), py(y));
    }
    drawScale(ctx, scale, height);
    inButton.disabled = zoom >= 6;
    outButton.disabled = zoom <= .62;
    fitButton.disabled = zoom === 1 && !shiftX && !shiftY;
  }

  function update({key, path, stops, position, destination}) {
    if (routeKey !== key) {
      routeKey = key;
      stopList = stops.map(([name, lat, lon]) => ({name, point:mercator([lat, lon])}));
      reset();
    }
    if (routePath !== path) {
      routePath = path;
      routeLine = [path.segments[0].a, ...path.segments.map(segment => segment.b)].map(mercator);
      extent = bounds([...routeLine, ...stopList.map(stop => stop.point)]);
    }
    current = position ? mercator(position) : null;
    target = destination;
    const names = stopList;
    canvas.setAttribute('aria-label', 'Bus route from ' + names[0].name + ' to ' + names.at(-1).name);
    schedule();
  }

  inButton.addEventListener('click', () => magnify(1.4));
  outButton.addEventListener('click', () => magnify(1 / 1.4));
  fitButton.addEventListener('click', reset);
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !extent) return;
    drag = {id:event.pointerId, x:event.clientX, y:event.clientY};
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    shiftX += event.clientX - drag.x;
    shiftY += event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    schedule();
  });
  canvas.addEventListener('lostpointercapture', () => { drag = null; canvas.classList.remove('dragging'); });
  new ResizeObserver(schedule).observe(canvas);

  return {
    update,
    setPlaces(stops) {
      places = areas.flatMap(area => {
        const stop = stops.find(row => row[0].toLowerCase() === area.toLowerCase())
          || stops.find(row => row[0].toLowerCase().startsWith(area.toLowerCase() + ' '));
        return stop ? [[area, mercator(stop.slice(1))]] : [];
      });
      schedule();
    }
  };
}

function drawScale(ctx, scale, height) {
  const metresPerPixel = 111195 * Math.cos(13 * Math.PI / 180) / scale;
  const metres = [10000, 5000, 2000, 1000, 500, 200, 100, 50].find(value => value / metresPerPixel <= 70);
  if (!metres) return;
  const barWidth = metres / metresPerPixel;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#506450';
  ctx.beginPath();
  ctx.moveTo(15, height - 14);
  ctx.lineTo(15, height - 10);
  ctx.lineTo(15 + barWidth, height - 10);
  ctx.lineTo(15 + barWidth, height - 14);
  ctx.stroke();
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#364e3e';
  ctx.fillText(metres >= 1000 ? metres / 1000 + ' km' : metres + ' m', 15, height - 17);
}
