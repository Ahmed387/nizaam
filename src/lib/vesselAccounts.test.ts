import { describe, it, expect } from "vitest";
import { accountKey, accountOfNumber, activeAccountsOf, vesselAccountError, type VesselAccount } from "./vesselAccounts";

const acc = (p: Partial<VesselAccount>): VesselAccount => ({
  id: p.id ?? "1", payment_method: p.payment_method ?? "vodafone", employee_id: null,
  holder_name: p.holder_name ?? "أحمد", account_number: p.account_number ?? "01012345678", is_active: p.is_active ?? true,
});

describe("vessel accounts", () => {
  it("normalises numbers like the server", () => {
    expect(accountKey("010 1234-5678")).toBe("01012345678");
    expect(accountKey("٠١٠١٢٣٤٥٦٧٨")).toBe("01012345678");
    expect(accountKey("EG12 ABC")).toBe("eg12abc");
    expect(accountKey(null)).toBe("");
  });
  it("lists only the active accounts of one vessel", () => {
    const l = [acc({ id: "1" }), acc({ id: "2", is_active: false }), acc({ id: "3", payment_method: "instapay" })];
    expect(activeAccountsOf("vodafone", l).map((a) => a.id)).toEqual(["1"]);
    expect(accountOfNumber("vodafone", "٠١٠-١٢٣٤٥٦٧٨", l)?.id).toBe("1");
  });
  it("requires one of the vessel's accounts when it has some", () => {
    const l = [acc({})];
    expect(vesselAccountError({ method: "vodafone", transfer_to_account: "01012345678" }, l)).toBeNull();
    expect(vesselAccountError({ method: "vodafone", transfer_from_account: "010 1234 5678" }, l)).toBeNull();
    expect(vesselAccountError({ method: "vodafone", transfer_to_account: "0109" }, l)).not.toBeNull();
    expect(vesselAccountError({ method: "instapay", transfer_to_account: "x" }, l)).toBeNull();
  });
});
