export type AccountAccessCode = "ACCOUNT_SUSPENDED" | "ACCOUNT_DELETED";

export class AccountAccessError extends Error {
  status = 403;
  code: AccountAccessCode;

  constructor(message: string, code: AccountAccessCode) {
    super(message);
    this.name = "AccountAccessError";
    this.code = code;
  }
}

export function isAccountAccessError(error: unknown): error is AccountAccessError {
  return error instanceof AccountAccessError;
}

export function accountAccessErrorPayload(error: unknown) {
  if (!isAccountAccessError(error)) return null;
  return {
    status: error.status,
    body: { error: error.message, code: error.code },
  };
}
