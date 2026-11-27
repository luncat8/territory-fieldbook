// Owns: headless visual snapshots — runs the model with no DOM and writes PNGs for every field.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { WaterLab, WATER_DT, WATER_SEED, waterMetrics } = require('./simulation.js');
const { WATER_MODES, waterPaint } = require('./palette.js');

const CRC_TABLE = new Int32Array(256);
for (let i = 0; i < 256; i++) {
	let c = i;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	CRC_TABLE[i] = c;
}

function crc32(buf) {
	let c = -1;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
}

function chunk(type, data) {
	const head = Buffer.alloc(4);
	head.writeUInt32BE(data.length, 0);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const tail = Buffer.alloc(4);
	tail.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([head, body, tail]);
}

function png(width, height, rgba, scale) {
	const outW = width * scale;
	const outH = height * scale;
	const stride = outW * 4 + 1;
	const raw = Buffer.alloc(stride * outH);
	for (let y = 0; y < height; y++) {
		const line = Buffer.alloc(outW * 4);
		for (let x = 0; x < width; x++) {
			const src = (y * width + x) * 4;
			for (let s = 0; s < scale; s++) {
				const dst = (x * scale + s) * 4;
				line[dst] = rgba[src];
				line[dst + 1] = rgba[src + 1];
				line[dst + 2] = rgba[src + 2];
				line[dst + 3] = 255;
			}
		}
		for (let s = 0; s < scale; s++) line.copy(raw, (y * scale + s) * stride + 1);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(outW, 0);
	ihdr.writeUInt32BE(outH, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

function parseArgs(argv) {
	const opts = { scenario: 'coast', seconds: 120, seed: WATER_SEED, out: 'preview', scale: 6, params: {}, flags: {} };
	let positional = 0;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--set' || arg === '--flag') {
			const [key, value] = (argv[++i] || '').split('=');
			const target = arg === '--set' ? opts.params : opts.flags;
			target[key] = value === 'true' ? true : value === 'false' ? false : Number.isNaN(Number(value)) ? value : Number(value);
			continue;
		}
		if (arg === '--out') { opts.out = argv[++i]; continue; }
		if (arg === '--scale') { opts.scale = Number(argv[++i]); continue; }
		if (positional === 0) opts.scenario = arg;
		else if (positional === 1) opts.seconds = Number(arg);
		else if (positional === 2) opts.seed = Number(arg);
		positional++;
	}
	return opts;
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	const model = new WaterLab({ scenario: opts.scenario, seed: opts.seed, params: opts.params });
	for (const key of Object.keys(opts.flags)) model[key] = opts.flags[key];
	const steps = Math.round(opts.seconds / WATER_DT);
	for (let k = 0; k < steps; k++) model.step();
	const dir = path.resolve(__dirname, opts.out);
	fs.mkdirSync(dir, { recursive: true });
	const rgba = new Uint8ClampedArray(model.n * 4);
	for (const mode of WATER_MODES) {
		waterPaint(model, mode, rgba);
		fs.writeFileSync(path.join(dir, mode + '.png'), png(model.width, model.rows, rgba, opts.scale));
	}
	const m = waterMetrics(model);
	const keys = ['time', 'landWater', 'wetFraction', 'riverShare', 'rainTotal', 'groupedRainShare', 'rainOnSea', 'groupMax', 'humidityMean', 'ledgerResidual'];
	console.log(keys.map(k => k + '=' + (typeof m[k] === 'number' ? m[k].toFixed(6) : m[k])).join(' '));
	console.log('seaDrain=' + model.seaDrain.toFixed(3) + ' groundDrain=' + model.groundDrain.toFixed(3) + ' rained=' + model.rained.toFixed(3));
	console.log('snapshots=' + dir);
}

main();
