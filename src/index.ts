const { name: packageName, version: packageVersion } = require(require("path").join(__dirname, "..", "package.json"));
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

import * as zxteam from "@zxteam/contract";

import * as http from "http";
import * as https from "https";
import { URL } from "url";


export class HttpClient implements HttpClient.InvokeChannel {
	private readonly _proxyOpts: HttpClient.ProxyOpts | null;
	private readonly _sslOpts: HttpClient.SslOpts | null;
	private readonly _log: zxteam.Logger;
	private readonly _requestTimeout: number | null;
	public constructor(opts?: HttpClient.Opts) {
		if (opts !== undefined && opts.log !== undefined) {
			this._log = opts.log;
		} else {
			this._log = DUMMY_LOGGER;
		}
		this._proxyOpts = opts && opts.proxyOpts || null;
		this._sslOpts = opts && opts.sslOpts || null;
		this._requestTimeout = opts && opts.timeout || null;
	}

	protected get log() { return this._log; }

	public async invoke(
		cancellationToken: zxteam.CancellationToken,
		{ url, method, headers, body }: HttpClient.Request
	): Promise<HttpClient.Response> {
		if (this.log.isTraceEnabled) { this.log.trace("begin invoke(...)", url, method, headers, body); }
		return new Promise<HttpClient.Response>((resolve, reject) => {
			const responseHandler = (response: http.IncomingMessage) => {
				const responseDataChunks: Array<Buffer> = [];
				response.on("data", (chunk: Buffer) => responseDataChunks.push(chunk));
				response.on("error", error => reject(error));
				response.on("end", () => {
					const respStatus = response.statusCode || 500;
					const respDescription = response.statusMessage || "";
					const respHeaders = response.headers;
					const respBody = Buffer.concat(responseDataChunks);

					if (respStatus < 400) {
						return resolve({
							statusCode: respStatus, statusMessage: respDescription,
							headers: respHeaders, body: respBody
						});
					} else {
						return reject(new HttpClient.WebError(respStatus, respDescription, respHeaders, respBody));
					}
				});
			};

			try {
				cancellationToken.throwIfCancellationRequested(); // Shoud raise error
			} catch (e) {
				return reject(e);
			}

			function registerCancelOperationIfNeeded(requestLike: { abort: () => void }) {
				if (cancellationToken !== undefined) {
					const cb = () => {
						cancellationToken.removeCancelListener(cb);
						requestLike.abort();
						try {
							cancellationToken.throwIfCancellationRequested(); // Shoud raise error
							// Guard for broken implementation of cancellationToken
							reject(new Error("Cancelled by user"));
						} catch (e) {
							reject(e);
						}
					};
					cancellationToken.addCancelListener(cb);
				}
			}

			let isConnecTimeout: boolean = false;
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
				if (this.log.isTraceEnabled) { this.log.trace("Call http.request", reqOpts); }
				const request = http.request(reqOpts, responseHandler)
					.on("error", error => {
						const msg = isConnecTimeout ? "Connect Timeout" : "http.request failed. See innderError for details";
						this.log.debug(msg, error);
						reject(new HttpClient.CommunicationError(msg, error));
					});
				if (this._requestTimeout !== null) {
					request.setTimeout(this._requestTimeout, () => {
						request.abort();
						isConnecTimeout = true;
					});
					request.on("socket", socket => {
						socket.setTimeout(this._requestTimeout);
						socket.on("timeout", () => {
							request.abort();
							isConnecTimeout = true;
						});
					});
				}
				if (body) {
					if (this.log.isTraceEnabled) { this.log.trace("write body", body.toString()); }
					request.write(body);
				}
				request.end();
				registerCancelOperationIfNeeded(request);
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
					if (this.log.isTraceEnabled) { this.log.trace("Call https.request", reqOpts); }
					const request = https.request(reqOpts, responseHandler)
						.on("error", error => {
							const msg = isConnecTimeout ? "Connect Timeout" : "http.request failed. See innderError for details";
							this.log.debug(msg, error);
							reject(new HttpClient.CommunicationError(msg, error));
						});
					if (this._requestTimeout !== null) {
						request.setTimeout(this._requestTimeout, () => {
							request.abort();
							isConnecTimeout = true;
						});
						request.on("socket", socket => {
							socket.setTimeout(this._requestTimeout);
							socket.on("timeout", () => {
								request.abort();
								isConnecTimeout = true;
							});
						});
					}
					if (body) {
						if (this.log.isTraceEnabled) { this.log.trace("Write body", body.toString()); }
						request.write(body);
					}
					request.end();
					registerCancelOperationIfNeeded(request);
				} else {
					if (this.log.isTraceEnabled) { this.log.trace("Call http.request", reqOpts); }
					const request = http.request(reqOpts, responseHandler)
						.on("error", error => {
							const msg = isConnecTimeout ? "Connect Timeout" : "http.request failed. See innderError for details";
							this.log.debug(msg, error);
							reject(new HttpClient.CommunicationError(msg, error));
						});
					if (this._requestTimeout !== null) {
						request.setTimeout(this._requestTimeout, () => {
							request.abort();
							isConnecTimeout = true;
						});
						request.on("socket", socket => {
							socket.setTimeout(this._requestTimeout);
							socket.on("timeout", () => {
								request.abort();
								isConnecTimeout = true;
							});
						});
					}
					if (body) {
						if (this.log.isTraceEnabled) { this.log.trace("Write body", body.toString()); }
						request.write(body);
					}
					request.end();
					registerCancelOperationIfNeeded(request);
				}
			}
		});
	}
}

export namespace HttpClient {
	export interface Opts {
		timeout?: number;
		proxyOpts?: ProxyOpts;
		sslOpts?: SslOpts;
		log?: zxteam.Logger;
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
		readonly statusMessage: string;
		readonly headers: http.IncomingHttpHeaders;
		readonly body: Buffer;
	}

	export type InvokeChannel = zxteam.InvokeChannel<Request, Response>;

	/** Base error type for WebClient */
	export abstract class HttpClientError extends Error {
	}

	/**
	 * WebError is a wrapper of HTTP responses with code 4xx/5xx
	 */
	export class WebError extends HttpClientError {
		public readonly name = "HttpClient.WebError";
		private readonly _statusCode: number;
		private readonly _statusDescription: string;
		private readonly _headers: http.IncomingHttpHeaders;
		private readonly _body: Buffer;

		public constructor(statusCode: number, statusDescription: string, headers: http.IncomingHttpHeaders, body: Buffer) {
			super(`${statusCode} ${statusDescription}`);
			this._statusCode = statusCode;
			this._statusDescription = statusDescription;
			this._headers = headers;
			this._body = body;
		}

		public get statusCode(): number { return this._statusCode; }
		public get statusDescription(): string { return this._statusDescription; }
		public get headers(): http.IncomingHttpHeaders { return this._headers; }
		public get body(): Buffer { return this._body; }
	}

	/**
	 * CommunicationError is a wrapper over underlaying network errors.
	 * Such a DNS lookup issues, TCP connection issues, etc...
	 */
	export class CommunicationError extends HttpClientError {
		public readonly name = "HttpClient.CommunicationError";
		private readonly _innerError?: Error;

		public constructor(message: string, innerError?: Error) {
			super(message);
			this._innerError = innerError;
		}

		public get innerError(): Error | undefined { return this._innerError; }
	}
}

export default HttpClient;

const DUMMY_LOGGER: zxteam.Logger = Object.freeze({
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
	fatal(message: string, ...args: any[]): void { /* NOP */ }
});
