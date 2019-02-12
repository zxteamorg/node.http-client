import * as http from "http";
import * as https from "https";
import { URL } from "url";

import { LoggerLike, CancellationTokenLike, InvokeTransportLike } from "@zxteam/contract";
import { Disposable } from "@zxteam/disposable";
import { loggerFactory } from "@zxteam/logger";

export interface WebClientInvokeArgs {
	url: URL;
	method: "CONNECT" | "DELETE" | "HEAD" | "GET" | "OPTIONS" | "PATCH" | "POST" | "PUT" | "TRACE" | string;
	headers?: http.OutgoingHttpHeaders;
	body?: Buffer;
}
export interface WebClientInvokeResult {
	statusCode: number;
	statusMessage?: string;
	headers: http.IncomingHttpHeaders;
	body?: Buffer;
}

export type WebClientLike = InvokeTransportLike<WebClientInvokeArgs, WebClientInvokeResult>;

export class WebClient extends Disposable implements WebClientLike {
	private readonly _proxyOpts: WebClient.ProxyOpts | null;
	private readonly _sslOpts: WebClient.SslOpts | null;
	private _log: LoggerLike;
	private _requestTimeout: number | null;
	public constructor(opts?: WebClient.Opts) {
		super();
		this._proxyOpts = opts && opts.proxyOpts || null;
		this._sslOpts = opts && opts.sslOpts || null;
		this._requestTimeout = opts && opts.timeout || null;
	}

	public get log() { return this._log || (this._log = loggerFactory.getLogger(this.constructor.name)); }
	public set log(value: LoggerLike) { this._log = value; }

	public invoke(
		{ url, method, headers, body }: WebClientInvokeArgs,
		cancellationToken?: CancellationTokenLike
	): Promise<WebClientInvokeResult> {
		super.verifyNotDisposed();

		if (this.log.isTraceEnabled) { this.log.trace("begin invoke(...)", url, method, headers, body); }
		return new Promise<WebClientInvokeResult>((resolve, reject) => {
			const responseHandler = (response: http.IncomingMessage) => {
				const responseDataChunks: Array<Buffer> = [];
				response.on("data", (chunk: Buffer) => responseDataChunks.push(chunk));
				response.on("error", error => reject(error));
				response.on("end", () => {
					const finalData = Buffer.concat(responseDataChunks);
					const statusCode = response.statusCode || 500;
					if (statusCode < 400) {
						return resolve({
							statusCode,
							statusMessage: response.statusMessage,
							headers: response.headers,
							body: finalData
						});
					} else {
						return reject(
							new WebClient.WebError(
								statusCode,
								response.statusMessage || "",
								finalData
							)
						);
					}
				});
			};
			if (cancellationToken) { cancellationToken.throwIfCancellationRequested(); }
			function registerCancelOperationIfNeeded(requestLike: { abort: () => void }) {
				if (cancellationToken) {
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

	export class Error extends GlobalError { }

	export class WebError extends Error {
		public readonly statusCode: number;
		public readonly statusDescription: string;
		public readonly errorData: Buffer;
		constructor(statusCode: number, statusDescription: string, data: Buffer) {
			super(`${statusCode} ${statusDescription}`);
			this.statusCode = statusCode;
			this.statusDescription = statusDescription;
			this.errorData = data;
		}
	}

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
