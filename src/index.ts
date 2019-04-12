import * as http from "http";
import * as https from "https";
import { URL } from "url";

import { Logger, CancellationToken, InvokeTransport, Task as TaskLike } from "@zxteam/contract";
import { Disposable } from "@zxteam/disposable";
import { loggerFactory } from "@zxteam/logger";
import { Task } from "ptask.js";

export interface WebClientInvokeArgs {
	url: URL;
	method: "CONNECT" | "DELETE" | "HEAD" | "GET" | "OPTIONS" | "PATCH" | "POST" | "PUT" | "TRACE" | string;
	headers?: http.OutgoingHttpHeaders;
	body?: Buffer;
}
export interface WebClientInvokeResult {
	statusCode: number;
	statusMessage: string;
	headers: http.IncomingHttpHeaders;
	body: Buffer;
}

export type WebClientLike = InvokeTransport<WebClientInvokeArgs, WebClientInvokeResult>;

export class WebClient extends Disposable implements WebClientLike {
	private readonly _proxyOpts: WebClient.ProxyOpts | null;
	private readonly _sslOpts: WebClient.SslOpts | null;
	private _log: Logger;
	private _requestTimeout: number | null;
	public constructor(opts?: WebClient.Opts) {
		super();
		if (opts !== undefined && opts.log !== undefined) {
			this._log = opts.log;
		} else {
			this._log = loggerFactory.getLogger(this.constructor.name);
		}
		this._proxyOpts = opts && opts.proxyOpts || null;
		this._sslOpts = opts && opts.sslOpts || null;
		this._requestTimeout = opts && opts.timeout || null;
	}

	protected get log() { return this._log; }

	public invoke(
		cancellationToken: CancellationToken,
		{ url, method, headers, body }: WebClientInvokeArgs
	): TaskLike<WebClientInvokeResult> {
		super.verifyNotDisposed();
		return Task.run(() => {
			if (this.log.isTraceEnabled) { this.log.trace("begin invoke(...)", url, method, headers, body); }
			return new Promise<WebClientInvokeResult>((resolve, reject) => {
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
							return reject(new WebClient.WebError(respStatus, respDescription, respHeaders, respBody));
						}
					});
				};
				if (cancellationToken !== undefined) { cancellationToken.throwIfCancellationRequested(); }
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
							reject(new WebClient.CommunicationError(msg, error));
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
								reject(new WebClient.CommunicationError(msg, error));
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
								reject(new WebClient.CommunicationError(msg, error));
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
		});
	}

	public onDispose(): void {
		// Nothing to do
	}
}

const GlobalError = Error;
export namespace WebClient {
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
		ca?: Buffer;
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

	/** Base error type for WebClient */
	export class Error extends GlobalError { }

	/**
	 * WebError is a wrapper of HTTP responses with code 4xx/5xx
	 */
	export class WebError extends Error {
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
	export class CommunicationError extends Error {
		private readonly _innerError?: Error;

		public constructor(message: string, innerError?: Error) {
			super(message);
			this._innerError = innerError;
		}

		public get innerError(): Error | undefined { return this._innerError; }
	}
}

export default WebClient;
