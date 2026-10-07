import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkedMri } from "./neuro/linked";

class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const blocked = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
  removeItem() {
    throw new Error("blocked");
  },
};

let local: MemoryStorage;
let tab: MemoryStorage;

/** Fresh modules, so the session's in-memory flag starts unset. */
async function load() {
  vi.resetModules();
  const session = await import("./session");
  const linked = await import("./neuro/linked");
  return { ...session, ...linked };
}

beforeEach(() => {
  local = new MemoryStorage();
  tab = new MemoryStorage();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", tab);
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("demo session", () => {
  it("opens the gate without an account and keeps it to this tab", async () => {
    const s = await load();
    expect(s.hasSession()).toBe(false);
    s.startDemo();
    expect(s.isDemo()).toBe(true);
    expect(s.hasSession()).toBe(true);
    expect(tab.getItem(s.DEMO_KEY)).not.toBeNull();
    // No account, nothing in the browser's persistent storage.
    expect(local.length).toBe(0);
    s.endSession();
    expect(s.hasSession()).toBe(false);
    expect(tab.length).toBe(0);
  });

  it("still honours a local account signed in before the demo", async () => {
    local.setItem("cognivance_session", JSON.stringify({ name: "A", email: "a@example.com" }));
    const s = await load();
    expect(s.isDemo()).toBe(false);
    expect(s.hasSession()).toBe(true);
    s.endSession();
    expect(local.getItem("cognivance_session")).toBeNull();
  });

  it("works where storage is blocked", async () => {
    vi.stubGlobal("localStorage", blocked);
    vi.stubGlobal("sessionStorage", blocked);
    const s = await load();
    expect(s.hasSession()).toBe(false);
    s.startDemo();
    expect(s.hasSession()).toBe(true);
    s.endSession();
    expect(s.hasSession()).toBe(false);
  });
});

describe("linked summaries in a demo", () => {
  const mri: LinkedMri = {
    origin: "console",
    kind: "template",
    label: "MNI152 template",
    fingerprint: "f",
    dims: [1, 1, 1],
    spacingMm: [1, 1, 1],
    acquisitionMonth: null,
    manufacturer: null,
    model: null,
    fieldStrength: null,
    sequence: null,
    linkedAt: "2026-10-07T00:00:00Z",
  };

  it("are kept in memory only, and start empty", async () => {
    local.setItem("cognivance_linked_v2", JSON.stringify({ scans: [{ key: "old" }] }));
    const s = await load();
    s.startDemo();
    expect(s.getLinked().scans).toEqual([]);
    s.setLinked({ mri });
    expect(s.getLinked().mri?.label).toBe("MNI152 template");
    expect(s.getLinked().scans).toHaveLength(1);
    // What was saved before is untouched, and nothing new was written.
    expect(JSON.parse(local.getItem("cognivance_linked_v2")!)).toEqual({
      scans: [{ key: "old" }],
    });
  });

  it("are saved as before outside a demo", async () => {
    const s = await load();
    s.setLinked({ mri });
    expect(JSON.parse(local.getItem("cognivance_linked_v2")!).mri.label).toBe("MNI152 template");
  });
});
