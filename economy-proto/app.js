(() => {
  'use strict';

  const WIDTH = 36;
  const HEIGHT = 24;
  const SIZE = WIDTH * HEIGHT;
  const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
  const indexOf = (x, y) => y * WIDTH + x;
  const resource = new Float32Array(SIZE);
  const demand = new Float32Array(SIZE);
  let baseline = 0;
  let sources = [];
  let consumers = [];
  let running = true;
  let speed = 1;
  let tool = 'inspect';
  let negativeDemand = false;
  let elapsed = 0;
  let lastFrame = performance.now();
  let lastStats = 0;

  const resourceCanvas = document.querySelector('#resource-map');
  const demandCanvas = document.querySelector('#demand-map');
  const resourceContext = resourceCanvas.getContext('2d');
  const demandContext = demandCanvas.getContext('2d');
  const runButton = document.querySelector('#run-button');
  const runLabel = runButton.querySelector('span:last-child');
  const runIcon = runButton.querySelector('.play-icon');
  const speedSelect = document.querySelector('#speed');
  const negativeToggle = document.querySelector('#negative-demand');
  const actorCount = document.querySelector('#actor-count');
  const resourceTotal = document.querySelector('#resource-total b');
  const demandMean = document.querySelector('#demand-mean b');
  const timeLabel = document.querySelector('#sim-time');
  const canvases = [resourceCanvas, demandCanvas];

  function newMap(fill) {
    baseline = fill;
    resource.fill(0);
    demand.fill(fill);
    sources = [{ x: 5, y: 12 }, { x: 29, y: 5 }];
    consumers = [{ x: 13, y: 6 }, { x: 21, y: 17 }, { x: 29, y: 14 }];
    elapsed = 0;
    updateStats();
    render();
  }

  function consumerInfluence(x, y) {
    let influence = 0;
    for (const actor of consumers) {
      const dx = x - actor.x;
      const dy = y - actor.y;
      influence += Math.exp(-(dx * dx + dy * dy) / 13);
    }
    return Math.min(1, influence);
  }

  function consumerTarget(x, y) {
    return Math.min(1, baseline + 0.82 * consumerInfluence(x, y));
  }

  function update(dt) {
    const demandDelta = new Float32Array(SIZE);
    const resourceDelta = new Float32Array(SIZE);

    // Demand diffuses and slowly follows settlement need; resource pressure lowers it.
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const i = indexOf(x, y);
        const here = demand[i];
        let laplacian = 0;
        if (x > 0) laplacian += demand[i - 1] - here;
        if (x < WIDTH - 1) laplacian += demand[i + 1] - here;
        if (y > 0) laplacian += demand[i - WIDTH] - here;
        if (y < HEIGHT - 1) laplacian += demand[i + WIDTH] - here;
        const resourceSink = negativeDemand ? 0.72 * resource[i] : 0;
        demandDelta[i] = (0.34 * laplacian + 0.19 * (consumerTarget(x, y) - here) - resourceSink) * dt;
      }
    }
    for (let i = 0; i < SIZE; i++) demand[i] = clamp(demand[i] + demandDelta[i]);

    // Steady production at sources.
    for (const source of sources) {
      const i = indexOf(source.x, source.y);
      resource[i] = clamp(resource[i] + 0.34 * dt);
    }

    // Filter the signed potential before taking its gradient. This damps cell-to-cell
    // noise and gives the flow a smoother, less grid-locked direction.
    let potential = new Float32Array(SIZE);
    let filtered = new Float32Array(SIZE);
    for (let i = 0; i < SIZE; i++) potential[i] = effectiveDemand(i);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          const i = indexOf(x, y);
          let neighborTotal = 0;
          let count = 0;
          if (x > 0) { neighborTotal += potential[i - 1]; count++; }
          if (x < WIDTH - 1) { neighborTotal += potential[i + 1]; count++; }
          if (y > 0) { neighborTotal += potential[i - WIDTH]; count++; }
          if (y < HEIGHT - 1) { neighborTotal += potential[i + WIDTH]; count++; }
          filtered[i] = 0.5 * potential[i] + 0.5 * neighborTotal / count;
        }
      }
      [potential, filtered] = [filtered, potential];
    }

    // Compute a vector for each cell and advect a gradient-scaled fraction along it.
    // Proposed transfers are resolved together; recipients can only take available
    // capacity, so blocked flow stays put instead of disappearing at full cells.
    const incoming = new Float32Array(SIZE);
    const edgeFrom = new Int16Array(SIZE * 2);
    const edgeTo = new Int16Array(SIZE * 2);
    const edgeAmount = new Float32Array(SIZE * 2);
    let edgeCount = 0;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const i = indexOf(x, y);
        const stock = resource[i];
        if (stock <= 0.00001) continue;
        const gx = x === 0 ? potential[i + 1] - potential[i]
          : x === WIDTH - 1 ? potential[i] - potential[i - 1]
            : (potential[i + 1] - potential[i - 1]) * 0.5;
        const gy = y === 0 ? potential[i + WIDTH] - potential[i]
          : y === HEIGHT - 1 ? potential[i] - potential[i - WIDTH]
            : (potential[i + WIDTH] - potential[i - WIDTH]) * 0.5;
        const magnitude = Math.hypot(gx, gy);
        if (magnitude < 0.0001) continue;
        const canMoveX = (gx > 0 && x < WIDTH - 1) || (gx < 0 && x > 0);
        const canMoveY = (gy > 0 && y < HEIGHT - 1) || (gy < 0 && y > 0);
        const weightX = canMoveX ? Math.abs(gx) : 0;
        const weightY = canMoveY ? Math.abs(gy) : 0;
        const axisWeight = weightX + weightY;
        if (!axisWeight) continue;
        const fraction = Math.min(0.3, 2.8 * magnitude * dt);
        if (weightX > 0) {
          const target = i + (gx > 0 ? 1 : -1);
          addEdge(i, target, stock * fraction * weightX / axisWeight);
        }
        if (weightY > 0) {
          const target = i + (gy > 0 ? WIDTH : -WIDTH);
          addEdge(i, target, stock * fraction * weightY / axisWeight);
        }
      }
    }
    for (let edge = 0; edge < edgeCount; edge++) {
      const from = edgeFrom[edge];
      const to = edgeTo[edge];
      const room = 1 - resource[to];
      const accepted = edgeAmount[edge] * Math.min(1, room / incoming[to]);
      resourceDelta[from] -= accepted;
      resourceDelta[to] += accepted;
    }
    for (let i = 0; i < SIZE; i++) resource[i] = clamp(resource[i] + resourceDelta[i]);

    // Settlements absorb on arrival across their demand footprint. Uptake is an
    // explicit per-second rate, proportional to both local need and local stock zone.
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const i = indexOf(x, y);
        const sinkRate = 1.55 * demand[i] * consumerInfluence(x, y);
        resource[i] = Math.max(0, resource[i] - Math.min(resource[i], sinkRate * dt));
      }
    }
    elapsed += dt;

    function addEdge(from, to, amount) {
      if (amount <= 0) return;
      edgeFrom[edgeCount] = from;
      edgeTo[edgeCount] = to;
      edgeAmount[edgeCount] = amount;
      incoming[to] += amount;
      edgeCount++;
    }
  }

  // The visible field stays within 0..1. This signed potential still creates an
  // outward gradient when local demand is already clamped at zero.
  function effectiveDemand(index) {
    return demand[index] - (negativeDemand ? 0.62 * resource[index] : 0);
  }

  const resourceStops = [
    [0, [20, 34, 27]], [0.15, [32, 67, 43]], [0.45, [48, 117, 65]],
    [0.75, [114, 174, 78]], [1, [198, 235, 112]]
  ];
  const demandStops = [
    [0, [22, 40, 48]], [0.2, [27, 70, 81]], [0.48, [40, 119, 129]],
    [0.76, [115, 164, 131]], [1, [233, 194, 103]]
  ];

  function colorAt(value, stops) {
    const n = clamp(value);
    let left = stops[0];
    let right = stops[stops.length - 1];
    for (let i = 1; i < stops.length; i++) {
      if (n <= stops[i][0]) { left = stops[i - 1]; right = stops[i]; break; }
    }
    const mix = (n - left[0]) / Math.max(0.00001, right[0] - left[0]);
    const channels = left[1].map((channel, i) => Math.round(channel + (right[1][i] - channel) * mix));
    return `rgb(${channels[0]} ${channels[1]} ${channels[2]})`;
  }

  function fitCanvases() {
    for (const canvas of canvases) {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
    render();
  }

  function drawMap(canvas, context, values, stops, kind) {
    const cellWidth = canvas.width / WIDTH;
    const cellHeight = canvas.height / HEIGHT;
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const i = indexOf(x, y);
        context.fillStyle = colorAt(values[i], stops);
        context.fillRect(x * cellWidth, y * cellHeight, Math.ceil(cellWidth), Math.ceil(cellHeight));
      }
    }
    context.strokeStyle = 'rgba(8, 16, 12, .28)';
    context.lineWidth = Math.max(0.5, canvas.width / 1500);
    context.beginPath();
    for (let x = 1; x < WIDTH; x++) {
      context.moveTo(x * cellWidth, 0);
      context.lineTo(x * cellWidth, canvas.height);
    }
    for (let y = 1; y < HEIGHT; y++) {
      context.moveTo(0, y * cellHeight);
      context.lineTo(canvas.width, y * cellHeight);
    }
    context.stroke();
    drawActors(context, cellWidth, cellHeight, kind);
  }

  function drawActors(context, cellWidth, cellHeight, kind) {
    const markerSize = Math.max(7, Math.min(cellWidth, cellHeight) * 0.62);
    for (const actor of sources) drawActor(actor, '#d0f582', '#263520', '+');
    for (const actor of consumers) drawActor(actor, '#f0c16f', '#3b2c1c', '−');
    function drawActor(actor, color, shadow, mark) {
      const x = (actor.x + 0.5) * cellWidth;
      const y = (actor.y + 0.5) * cellHeight;
      context.beginPath();
      context.arc(x, y, markerSize * 0.64, 0, Math.PI * 2);
      context.fillStyle = shadow;
      context.fill();
      context.strokeStyle = color;
      context.lineWidth = Math.max(1, markerSize * 0.1);
      context.stroke();
      context.fillStyle = color;
      context.font = `700 ${markerSize * 1.05}px sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(mark, x, y + 0.5);
    }
  }

  function render() {
    if (!resourceCanvas.width || !demandCanvas.width) return;
    drawMap(resourceCanvas, resourceContext, resource, resourceStops, 'resource');
    drawMap(demandCanvas, demandContext, demand, demandStops, 'demand');
  }

  function updateStats() {
    let total = 0;
    let sum = 0;
    for (let i = 0; i < SIZE; i++) { total += resource[i]; sum += demand[i]; }
    resourceTotal.textContent = total.toFixed(2);
    demandMean.textContent = (sum / SIZE).toFixed(2);
    actorCount.textContent = `${sources.length} ${sources.length === 1 ? 'SOURCE' : 'SOURCES'} · ${consumers.length} ${consumers.length === 1 ? 'CONSUMER' : 'CONSUMERS'}`;
    const seconds = Math.floor(elapsed);
    timeLabel.innerHTML = `SIM TIME&nbsp; ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function frame(now) {
    const rawDt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (running && rawDt > 0) {
      let remaining = rawDt * speed;
      while (remaining > 0) {
        const step = Math.min(0.025, remaining);
        update(step);
        remaining -= step;
      }
      render();
      if (now - lastStats > 250) { updateStats(); lastStats = now; }
    }
    requestAnimationFrame(frame);
  }

  function gridPoint(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp(Math.floor((event.clientX - rect.left) / rect.width * WIDTH), 0, WIDTH - 1),
      y: clamp(Math.floor((event.clientY - rect.top) / rect.height * HEIGHT), 0, HEIGHT - 1)
    };
  }

  function actorAt(x, y) {
    return [...sources.map((actor) => ({ actor, list: sources })), ...consumers.map((actor) => ({ actor, list: consumers }))]
      .find(({ actor }) => actor.x === x && actor.y === y);
  }

  function interact(canvas, event) {
    const { x, y } = gridPoint(canvas, event);
    if (tool === 'source' || tool === 'consumer') {
      const occupied = actorAt(x, y);
      if (!occupied) (tool === 'source' ? sources : consumers).push({ x, y });
    } else if (tool === 'erase') {
      const found = actorAt(x, y);
      if (found) found.list.splice(found.list.indexOf(found.actor), 1);
    }
    updateStats();
    render();
    showTooltip(canvas, event);
  }

  function showTooltip(canvas, event) {
    const tooltip = canvas.parentElement.querySelector('.canvas-tooltip');
    const { x, y } = gridPoint(canvas, event);
    const i = indexOf(x, y);
    const actor = actorAt(x, y);
    const kind = canvas === resourceCanvas ? 'STOCK' : 'DEMAND';
    const value = canvas === resourceCanvas ? resource[i] : demand[i];
    const actorName = actor ? (sources.includes(actor.actor) ? ' · PRODUCER' : ' · CONSUMER') : '';
    tooltip.textContent = `${x + 1}, ${y + 1}  ·  ${kind} ${value.toFixed(2)}${actorName}`;
    const rect = canvas.getBoundingClientRect();
    tooltip.style.left = `${clamp(event.clientX - rect.left, 0, rect.width - 128)}px`;
    tooltip.style.top = `${clamp(event.clientY - rect.top, 0, rect.height - 28)}px`;
    tooltip.style.display = 'block';
  }

  runButton.addEventListener('click', () => {
    running = !running;
    runLabel.textContent = running ? 'Pause' : 'Resume';
    runIcon.textContent = running ? 'Ⅱ' : '▶';
    runButton.setAttribute('aria-label', running ? 'Pause simulation' : 'Resume simulation');
    lastFrame = performance.now();
  });
  speedSelect.addEventListener('change', () => { speed = Number(speedSelect.value); });
  negativeToggle.addEventListener('change', () => { negativeDemand = negativeToggle.checked; });
  document.querySelector('#new-zero').addEventListener('click', () => newMap(0));
  document.querySelector('#new-half').addEventListener('click', () => newMap(0.5));
  document.querySelectorAll('.tool-button').forEach((button) => {
    button.addEventListener('click', () => {
      tool = button.dataset.tool;
      document.querySelectorAll('.tool-button').forEach((candidate) => candidate.classList.toggle('active', candidate === button));
      canvases.forEach((canvas) => { canvas.parentElement.style.cursor = tool === 'inspect' ? 'crosshair' : 'cell'; });
    });
  });
  for (const canvas of canvases) {
    canvas.addEventListener('click', (event) => interact(canvas, event));
    canvas.addEventListener('pointermove', (event) => showTooltip(canvas, event));
    canvas.addEventListener('pointerleave', () => { canvas.parentElement.querySelector('.canvas-tooltip').style.display = 'none'; });
  }
  window.addEventListener('resize', fitCanvases);

  newMap(0);
  fitCanvases();
  requestAnimationFrame(frame);
})();
