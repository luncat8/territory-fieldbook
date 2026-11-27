// Owns: namespaced lab preference persistence — scenario gold, bank capital, transport rule and the credit-money switch.
// Edit for: stored field names and version; a reload starts a fresh scene and never claims to resume a running economy.
'use strict';

const SETTINGS_KEY = 'particle-transfer-b2.settings.v1';

class LabSettings {
	constructor(storage) {
		this.storage = storage || null;
		this.data = this.load();
	}

	defaults() {
		return { goldPerWorker: 1, bankCapital: 0, transportPreset: 0, creditMoney: false };
	}

	load() {
		const data = this.defaults();
		if (!this.storage) return data;
		try {
			const saved = JSON.parse(this.storage.getItem(SETTINGS_KEY));
			if (!saved || typeof saved !== 'object') return data;
			for (const key of Object.keys(data)) this.adopt(data, key, saved[key]);
		} catch {
			// Storage failure must not stop the file:// lab; defaults stay in memory.
		}
		return data;
	}

	adopt(data, key, value) {
		if (typeof data[key] === 'boolean') {
			if (typeof value === 'boolean') data[key] = value;
			return;
		}
		const n = Number(value);
		if (!Number.isFinite(n) || n < 0) return;
		if (key === 'transportPreset' && n !== TRANSPORT_T0 && n !== TRANSPORT_T1) return;
		data[key] = n;
	}

	save() {
		if (!this.storage) return false;
		try {
			this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.data));
			return true;
		} catch {
			return false;
		}
	}

	// Copyable JSON for comparisons; import accepts the same shape and ignores malformed values.
	export() {
		return JSON.stringify(this.data);
	}

	import(text) {
		try {
			const saved = JSON.parse(text);
			if (!saved || typeof saved !== 'object') return false;
			for (const key of Object.keys(this.data)) this.adopt(this.data, key, saved[key]);
			return true;
		} catch {
			return false;
		}
	}
}

if (typeof module === 'object') module.exports = { LabSettings, SETTINGS_KEY };
