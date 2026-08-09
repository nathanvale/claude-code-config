import type {
	VaultGitLifecycleResultPayload,
	VaultGitStateSnapshot,
} from "./model.ts";

/** Read-side request accepted by a future transaction engine. */
export interface VaultGitReadRequest {
	/** Public read command. */
	readonly command: "status" | "preview" | "doctor";
	/** Optional non-secret transaction correlation id. */
	readonly transactionId?: string;
}

/** Mutation request accepted only after future admission policy succeeds. */
export interface VaultGitMutationRequest {
	/** Public mutating command. */
	readonly command: "begin" | "join" | "complete" | "repair" | "tidy" | "janitor";
	/** Optional inherited capability descriptor number, never capability bytes. */
	readonly capabilityFd?: number;
}

/** Read-only state boundary implemented by the future engine. */
export interface VaultGitStatePort {
	/** Read current manager-owned state without mutation. */
	read(request: VaultGitReadRequest): Promise<VaultGitStateSnapshot>;
}

/** Admitted mutation boundary implemented by the future engine. */
export interface VaultGitMutationPort {
	/** Execute one admitted mutation or return a deterministic refusal. */
	mutate(request: VaultGitMutationRequest): Promise<VaultGitLifecycleResultPayload>;
}

/** Capability-byte reader isolated behind an inherited descriptor boundary. */
export interface VaultGitCapabilityPort {
	/** Read capability bytes from a numeric inherited descriptor. */
	readCapability(descriptor: number): Promise<Uint8Array>;
}
