import { describe, expect, it } from "vitest";
import {
  approveRecoveryOptionAtomic,
  type ApprovalRpcClient,
  type ApprovalRpcRow,
} from "@/lib/supabase/approval";

function fakeClient(result: {
  data: ApprovalRpcRow | null;
  error: { message?: string } | null;
}): {
  client: ApprovalRpcClient;
  calls: { fn: string; args: Record<string, string> }[];
} {
  const calls: { fn: string; args: Record<string, string> }[] = [];
  return {
    calls,
    client: {
      rpc(fn, args) {
        calls.push({ fn, args });
        return {
          async maybeSingle() {
            return result;
          },
        };
      },
    },
  };
}

describe("approveRecoveryOptionAtomic", () => {
  it("calls the atomic approval RPC with the requested simulation and option", async () => {
    const { client, calls } = fakeClient({
      data: { option_row_id: 7, simulation_row_id: 3 },
      error: null,
    });

    const result = await approveRecoveryOptionAtomic(client, {
      simulationUuid: "00000000-0000-0000-0000-000000000001",
      optionId: "OPT-123",
    });

    expect(result).toEqual({
      ok: true,
      data: { option_row_id: 7, simulation_row_id: 3 },
    });
    expect(calls).toEqual([
      {
        fn: "approve_recovery_option",
        args: {
          p_simulation_uuid: "00000000-0000-0000-0000-000000000001",
          p_option_id: "OPT-123",
        },
      },
    ]);
  });

  it("returns failure when the RPC rejects a stale option id", async () => {
    const { client } = fakeClient({
      data: null,
      error: { message: "Recovery option not found" },
    });

    const result = await approveRecoveryOptionAtomic(client, {
      simulationUuid: "00000000-0000-0000-0000-000000000001",
      optionId: "STALE",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Recovery option not found");
  });

  it("returns a specific migration hint when the approval function is missing", async () => {
    const { client } = fakeClient({
      data: null,
      error: {
        message:
          "Could not find the function public.approve_recovery_option(p_option_id, p_simulation_uuid)",
      },
    });

    const result = await approveRecoveryOptionAtomic(client, {
      simulationUuid: "00000000-0000-0000-0000-000000000001",
      optionId: "OPT-123",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/0003_approval_safety\.sql/);
  });
});
