import { describe, expect, it } from "vitest";
import { etaStepState } from "./etaWizard";

const base = { client_id: null, has_secret: false, connection_ok_at: null, enabled: false };
const none = { portalOpened: false, erpDone: false };

describe("etaStepState", () => {
  it("starts on step 1", () => expect(etaStepState(base, none).current).toBe(1));
  it("moves with the owner's ticks on the portal steps", () => {
    expect(etaStepState(base, { portalOpened: true, erpDone: false }).current).toBe(2);
    expect(etaStepState(base, { portalOpened: true, erpDone: true }).current).toBe(3);
  });
  it("saved credentials mean steps 1–3 are done; a passed test opens step 5", () => {
    const saved = { ...base, client_id: "x", has_secret: true };
    expect(etaStepState(saved, none).current).toBe(4);
    expect(etaStepState({ ...saved, connection_ok_at: "2026-11-15" }, none).current).toBe(5);
    expect(etaStepState({ ...saved, connection_ok_at: "2026-11-15", enabled: true }, none).done[5]).toBe(true);
  });
  it("a client id without a secret is not saved", () => {
    expect(etaStepState({ ...base, client_id: "x" }, { portalOpened: true, erpDone: true }).current).toBe(3);
  });
});
