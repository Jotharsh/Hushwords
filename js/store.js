// What stays on this device. Every access is wrapped because storage can be blocked (private windows, strict settings).
const read = (area, key, fallback) => { try { const v = area.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };
const write = (area, key, value) => { try { area.setItem(key, JSON.stringify(value)); } catch { /* blocked: the app still works, it just forgets */ } };
const remove = (area, key) => { try { area.removeItem(key); } catch {} };
const local = () => { try { return localStorage; } catch { return memory; } };
const session = () => { try { return sessionStorage; } catch { return memory; } };
const memory = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; }, removeItem(k) { delete this.data[k]; } };

export const nick = { get: () => read(local(), 'hushwords.nick', ''), set: (v) => write(local(), 'hushwords.nick', v) };
export const muted = { get: () => read(local(), 'hushwords.muted', false), set: (v) => write(local(), 'hushwords.muted', v) };
export const token = {
  get() {
    let t = read(local(), 'hushwords.token', '');
    if (!t) { t = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); write(local(), 'hushwords.token', t); }
    return t;
  },
};

export const hostRecord = {
  get: () => read(local(), 'hushwords.host', null),
  set: (v) => write(local(), 'hushwords.host', v),
  clear: () => remove(local(), 'hushwords.host'),
};

/** Where this tab has already been let in, so a refresh does not ask for the password again. */
export const joined = {
  get: (code) => read(session(), `hushwords.joined.${code}`, null),
  set: (code, v) => write(session(), `hushwords.joined.${code}`, v),
  clear: (code) => remove(session(), `hushwords.joined.${code}`),
};

export const recent = {
  list: () => read(local(), 'hushwords.recent', []),
  add(entry) {
    const list = recent.list().filter((r) => r.code !== entry.code);
    list.unshift({ ...entry, at: Date.now() });
    write(local(), 'hushwords.recent', list.slice(0, 5));
  },
  remove(code) { write(local(), 'hushwords.recent', recent.list().filter((r) => r.code !== code)); },
};
