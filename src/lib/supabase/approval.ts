export interface ApprovalRpcRow {
  option_row_id: number;
  simulation_row_id: number;
}

interface RpcError {
  message?: string;
}

interface ApprovalRpcBuilder {
  maybeSingle: () => PromiseLike<{
    data: ApprovalRpcRow | null;
    error: RpcError | null;
  }>;
}

export interface ApprovalRpcClient {
  rpc: (
    fn: "approve_recovery_option",
    args: {
      p_simulation_uuid: string;
      p_option_id: string;
    },
  ) => ApprovalRpcBuilder;
}

export interface ApprovalResult {
  ok: boolean;
  message?: string;
  data?: ApprovalRpcRow;
}

function approvalErrorMessage(error: RpcError | null): string {
  const message = error?.message?.trim();
  if (!message) return "Approval failed";
  if (message.includes("approve_recovery_option")) {
    return "Approval function is not installed. Run Supabase migrations through 0003_approval_safety.sql.";
  }
  return message;
}

export async function approveRecoveryOptionAtomic(
  client: ApprovalRpcClient,
  input: {
    simulationUuid: string;
    optionId: string;
  },
): Promise<ApprovalResult> {
  const { data, error } = await client
    .rpc("approve_recovery_option", {
      p_simulation_uuid: input.simulationUuid,
      p_option_id: input.optionId,
    })
    .maybeSingle();

  if (error) return { ok: false, message: approvalErrorMessage(error) };
  if (!data) return { ok: false, message: "Recovery option not found" };
  return { ok: true, data };
}
