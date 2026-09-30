export type MedusaErrorCode =
	| "CONFIGURATION"
	| "INPUT"
	| "AUTHENTICATION"
	| "REQUEST"
	| "UNAVAILABLE"
	| "INVALID_RESPONSE"
	| "NETWORK"
	| "TIMEOUT";

export class MedusaError extends Error {
	readonly code: MedusaErrorCode;
	readonly status?: number;

	constructor(code: MedusaErrorCode, message: string, status?: number) {
		super(message);
		this.name = "MedusaError";
		this.code = code;
		this.status = status;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}
