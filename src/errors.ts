/** Error thrown when the Meteora DLMM API returns a non-2xx response. */
export class MeteoraApiError extends Error {
	readonly status: number;
	readonly body: unknown;

	constructor(status: number, message: string, body: unknown) {
		super(message);
		this.name = 'MeteoraApiError';
		this.status = status;
		this.body = body;
	}
}
