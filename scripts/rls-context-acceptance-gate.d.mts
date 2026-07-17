export type RlsContextGateConfig = {
  [key: string]: unknown;
  localityConfirmation?: string;
  prepare?: boolean;
  providerCommitSha?: string | null;
  providerDeploymentId?: string | null;
  rollbackProbe?: boolean;
};

export type RlsContextGateResult = {
  issues: string[];
  locality: {
    queryRttProxy: unknown;
  };
  reports: string[];
};

export function parseGateConfig(env?: NodeJS.ProcessEnv): RlsContextGateConfig;

export function runAcceptanceGate(
  config: RlsContextGateConfig,
): Promise<RlsContextGateResult>;

export function buildEvidencePayload(
  config: RlsContextGateConfig,
  result: RlsContextGateResult,
  timing: {
    finishedAt: string;
    startedAt: string;
    status: "failed" | "passed";
  },
  env?: NodeJS.ProcessEnv,
): Record<string, unknown>;

export function claimProviderRuntimeRunSlot(
  config: RlsContextGateConfig,
  claim: {
    runId: string;
    runSlot: 1 | 2;
  },
): Promise<boolean>;

export function completeProviderRuntimeRunSlot(
  config: RlsContextGateConfig,
  completion: {
    evidence: Record<string, unknown>;
    runId: string;
    runSlot: 1 | 2;
    succeeded: boolean;
  },
): Promise<void>;
