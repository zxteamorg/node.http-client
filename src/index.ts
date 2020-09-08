const { name: packageName, version: packageVersion } = require("../package.json");
const G: any = global || window || {};
const PACKAGE_GUARD: symbol = Symbol.for(packageName);
if (PACKAGE_GUARD in G) {
	const conflictVersion = G[PACKAGE_GUARD];
	// tslint:disable-next-line: max-line-length
	const msg = `Conflict module version. Look like two different version of package ${packageName} was loaded inside the process: ${conflictVersion} and ${packageVersion}.`;
	if (process !== undefined && process.env !== undefined && process.env.NODE_ALLOW_CONFLICT_MODULES === "1") {
		console.warn(msg + " This treats as warning because NODE_ALLOW_CONFLICT_MODULES is set.");
	} else {
		throw new Error(msg + " Use NODE_ALLOW_CONFLICT_MODULES=\"1\" to treats this error as warning.");
	}
} else {
	G[PACKAGE_GUARD] = packageVersion;
}

import { CancellationToken, Logger, InvokeChannel } from "@zxteam/contract";
import { InnerError, CancelledError, InvalidOperationError } from "@zxteam/errors";

import * as http from "http";
import * as https from "https";

export class HttpClient implements HttpClient.HttpInvokeChannel {
	private readonly _proxyOpts: HttpClient.ProxyOpts | null;
	private readonly _sslOpts: HttpClient.SslOpts | null;
	private readonly _log: Logger;
	private readonly _requestTimeout: number;
	public constructor(opts?: HttpClient.Opts) {
		if (opts !== undefined && opts.log !== undefined) {
			this._log = opts.log;
		} else {
			this._log = DUMMY_LOGGER;
		}
		this._proxyOpts = opts && opts.proxyOpts || null;
		this._sslOpts = opts && opts.sslOpts || null;
		this._requestTimeout = opts && opts.timeout || HttpClient.DEFAULT_TIMEOUT;
	}

	protected get log() { return this._log; }

	public async invoke(
		cancellationToken: CancellationToken,
		{ url, method, headers, body }: HttpClient.Request
	): Promise<HttpClient.Response> {
		if (this.log.isTraceEnabled) { this.log.trace("begin invoke(...)", url, method, headers, body); }
		return new Promise<HttpClient.Response>((resolve, reject) => {
			let isConnectTimeout: boolean = false;
			let resolved: boolean = false;

			const errorHandler = (error: Error) => {
				if (!resolved) {
					resolved = true;
					const msg = isConnectTimeout ? "Connect Timeout"
						: `${method} ${url} failed with error: ${error.message}. See innerError for details`;
					this.log.debug(msg, error);
					return reject(new HttpClient.CommunicationError(msg, error));
				}
			};

			const responseHandler = (response: http.IncomingMessage) => {
				const responseDataChunks: Array<Buffer> = [];
				response.on("data", (chunk: Buffer) => responseDataChunks.push(chunk));
				response.on("error", errorHandler);
				response.on("end", () => {
					if (!resolved) {
						resolved = true;

						if (isConnectTimeout) {
							return reject(new HttpClient.CommunicationError("Connect Timeout"));
						}

						const respStatus: number = response.statusCode || 500;
						const respDescription: string = response.statusMessage || "";
						const respHeaders = response.headers;
						const respBody: Buffer = Buffer.concat(responseDataChunks);

						if (this.log.isTraceEnabled) {
							this.log.trace(`Recv: ${JSON.stringify({ respStatus, respDescription, respHeaders })}`);
							this.log.trace(`Recv body: ${respBody.toString()}`);
						}

						if (respStatus < 400) {
							return resolve({
								statusCode: respStatus, statusDescription: respDescription,
								headers: respHeaders, body: respBody
							});
						} else {
							return reject(
								new HttpClient.WebError(
									respStatus, respDescription,
									method,
									headers !== undefined ? headers : {}, body !== undefined ? body : Buffer.alloc(0),
									respHeaders, respBody
								)
							);
						}
					}
				});
			};

			try {
				cancellationToken.throwIfCancellationRequested(); // Shoud raise error
			} catch (e) {
				return reject(e);
			}

			const request = this.createClientRequest({ url, method, headers }, responseHandler);
			if (body !== undefined) {
				if (this.log.isTraceEnabled) { this.log.trace("Write body: ", body.toString()); }
				request.write(body);
			}
			request.end();
			request.on("error", errorHandler);
			request.setTimeout(this._requestTimeout, () => {
				isConnectTimeout = true;
				request.abort();
			});
			request.on("socket", socket => {
				// this will setup connect timeout
				socket.setTimeout(this._requestTimeout);
				// socket.on("timeout", () => {
				// 	isConnectTimeout = true;
				// 	request.abort();
				// });
			});
			if (cancellationToken !== undefined) {
				const cb = () => {
					cancellationToken.removeCancelListener(cb);
					request.abort();
					if (!resolved) {
						resolved = true;
						try {
							cancellationToken.throwIfCancellationRequested(); // Should raise error
							// Guard for broken implementation of cancellationToken
							reject(new CancelledError("Cancelled by user"));
						} catch (e) {
							reject(e);
						}
					}
				};
				cancellationToken.addCancelListener(cb);
			}
		});
	}

	private createClientRequest(
		{ url, method, headers }: HttpClient.Request,
		callback: (res: http.IncomingMessage) => void
	): http.ClientRequest {
		const proxyOpts = this._proxyOpts;
		if (proxyOpts && proxyOpts.type === "http") {
			const reqOpts = {
				protocol: "http:",
				host: proxyOpts.host,
				port: proxyOpts.port,
				path: url.href,
				method,
				headers: { Host: url.host, ...headers }
			};
			this.log.trace("Call http.request", reqOpts);
			return http.request(reqOpts, callback);
		} else {
			const reqOpts: https.RequestOptions = {
				protocol: url.protocol,
				host: url.hostname,
				port: url.port,
				path: url.pathname + url.search,
				method: method,
				headers: headers
			};
			if (reqOpts.protocol === "https:") {
				const sslOpts = this._sslOpts;
				if (sslOpts) {
					if (sslOpts.ca) {
						reqOpts.ca = sslOpts.ca;
					}
					if (sslOpts.rejectUnauthorized !== undefined) {
						reqOpts.rejectUnauthorized = sslOpts.rejectUnauthorized;
					}
					if ("pfx" in sslOpts) {
						reqOpts.pfx = sslOpts.pfx;
						reqOpts.passphrase = sslOpts.passphrase;
					} else if ("cert" in sslOpts) {
						reqOpts.key = sslOpts.key;
						reqOpts.cert = sslOpts.cert;
					}
				}
				this.log.trace("Call https.request", reqOpts);
				return https.request(reqOpts, callback);
			} else {
				this.log.trace("Call http.request", reqOpts);
				return http.request(reqOpts, callback);
			}
		}
	}
}

export namespace HttpClient {
	export const DEFAULT_TIMEOUT: number = 60000;

	export interface Opts {
		timeout?: number;
		proxyOpts?: ProxyOpts;
		sslOpts?: SslOpts;
		log?: Logger;
	}

	export type ProxyOpts = HttpProxyOpts | Socks5ProxyOpts;

	export interface HttpProxyOpts {
		type: "http";
		host: string;
		port: number;
	}

	export interface Socks5ProxyOpts {
		type: "socks5";
	}

	export type SslOpts = SslOptsBase | SslCertOpts | SslPfxOpts;

	export interface SslOptsBase {
		ca?: Buffer | Array<Buffer>;
		rejectUnauthorized?: boolean;
	}

	export interface SslCertOpts extends SslOptsBase {
		key: Buffer;
		cert: Buffer;
	}

	export interface SslPfxOpts extends SslOptsBase {
		pfx: Buffer;
		passphrase: string;
	}

	export const enum HttpMethod {
		CONNECT = "CONNECT",
		DELETE = "DELETE",
		HEAD = "HEAD",
		GET = "GET",
		OPTIONS = "OPTIONS",
		PATCH = "PATCH",
		POST = "POST",
		PUT = "PUT",
		TRACE = "TRACE"
	}

	export interface Request {
		readonly url: URL;
		readonly method: HttpMethod | string;
		readonly headers?: http.OutgoingHttpHeaders;
		readonly body?: Buffer;
	}
	export interface Response {
		readonly statusCode: number;
		readonly statusDescription: string;
		readonly headers: http.IncomingHttpHeaders;
		readonly body: Buffer;
	}

	export type HttpInvokeChannel = InvokeChannel<Request, Response>;

	/** Base error type for WebClient */
	export abstract class HttpClientError extends InnerError {
	}

	/**
	 * WebError is a wrapper of HTTP responses with code 4xx/5xx
	 */
	export class WebError extends HttpClientError implements Response {
		private readonly _statusCode: number;
		private readonly _statusDescription: string;
		private readonly _method: string;
		private readonly _requestHeaders: http.OutgoingHttpHeaders;
		private readonly _requestBody: Buffer;
		private readonly _responseHeaders: http.IncomingHttpHeaders;
		private readonly _responseBody: Buffer;

		public constructor(
			statusCode: number, statusDescription: string,
			method: string,
			requestHeaders: http.OutgoingHttpHeaders, requestBody: Buffer,
			responseHeaders: http.IncomingHttpHeaders, responseBody: Buffer,
			innerError?: Error
		) {
			super(`${statusCode} ${statusDescription}`, innerError);
			this._statusCode = statusCode;
			this._statusDescription = statusDescription;
			this._method = method;
			this._requestHeaders = requestHeaders;
			this._requestBody = requestBody;
			this._responseHeaders = responseHeaders;
			this._responseBody = responseBody;
		}

		public get statusCode(): number { return this._statusCode; }
		public get statusDescription(): string { return this._statusDescription; }
		public get method(): string { return this._method; }
		public get requestHeaders(): http.OutgoingHttpHeaders { return this._requestHeaders; }
		public get requestBody(): Buffer { return this._requestBody; }
		public get requestObject(): any {
			const requestHeaders: http.OutgoingHttpHeaders = this.requestHeaders;
			const contentTypeHeaderName: string | undefined = Object.keys(requestHeaders).find(header => header.toLowerCase() === "content-type");
			if (contentTypeHeaderName !== undefined && requestHeaders[contentTypeHeaderName] !== "application/json") {
				throw new InvalidOperationError("Wrong operation. The property available only for 'application/json' content type requests.");
			}
			return JSON.parse(this.requestBody.toString());
		}
		public get headers(): http.IncomingHttpHeaders { return this._responseHeaders; }
		public get body(): Buffer { return this._responseBody; }
		public get object(): any {
			const headers: http.IncomingHttpHeaders = this.headers;
			const contentTypeHeaderName: string | undefined = Object.keys(headers).find(header => header.toLowerCase() === "content-type");
			if (contentTypeHeaderName !== undefined && headers[contentTypeHeaderName] !== "application/json") {
				throw new InvalidOperationError("Wrong operation. The property available only for 'application/json' content type responses.");
			}
			return JSON.parse(this.body.toString());
		}
	}

	/**
	 * CommunicationError is a wrapper over underlaying network errors.
	 * Such a DNS lookup issues, TCP connection issues, etc...
	 */
	export class CommunicationError extends HttpClientError {
		public constructor(message: string, innerError?: Error) {
			super(message, innerError);
		}
	}
}

export default HttpClient;

const DUMMY_LOGGER: Logger = Object.freeze({
	get isTraceEnabled(): boolean { return false; },
	get isDebugEnabled(): boolean { return false; },
	get isInfoEnabled(): boolean { return false; },
	get isWarnEnabled(): boolean { return false; },
	get isErrorEnabled(): boolean { return false; },
	get isFatalEnabled(): boolean { return false; },

	trace(message: string, ...args: any[]): void { /* NOP */ },
	debug(message: string, ...args: any[]): void { /* NOP */ },
	info(message: string, ...args: any[]): void { /* NOP */ },
	warn(message: string, ...args: any[]): void { /* NOP */ },
	error(message: string, ...args: any[]): void { /* NOP */ },
	fatal(message: string, ...args: any[]): void { /* NOP */ },

	getLogger(name?: string): Logger { /* NOP */ return this; }
});
