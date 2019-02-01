import * as http from "http";
import * as querystring from "querystring";
import { URL } from "url";
import { Limit, LimitToken, limitFactory } from "limit.js";
import { LoggerLike, CancellationTokenLike } from "@zxteam/contract";
import { Disposable } from "@zxteam/disposable";
import { loggerFactory } from "@zxteam/logger";

import { WebClient, WebClientLike } from "./WebClient";

export namespace WebApiClient {
	export interface Opts {
		url: string;
		limit?: {
			opts: Limit.Opts;
			timeout: number;
		};
		webClient?: WebClient.Opts | WebClientLike;
	}
}
export class WebApiClient extends Disposable {
	private static _webClientFactory?: (opts?: WebClient.Opts) => WebClientLike;
	private readonly _baseUrl: URL;
	private readonly _webClient: WebClientLike;
	private readonly _limit?: { instance: Limit, timeout: number };
	private _log: LoggerLike | null;

	public constructor(opts: WebApiClient.Opts) {
		super();
		this._baseUrl = new URL(opts.url);
		if (opts.limit) {
			this._limit = {
				instance: limitFactory(opts.limit.opts),
				timeout: opts.limit.timeout
			};
		}
		this._log = null;
		if (opts.webClient && "invoke" in opts.webClient) {
			this._webClient = opts.webClient;
		} else if (WebApiClient._webClientFactory) {
			this._webClient = WebApiClient._webClientFactory(opts.webClient);
		} else {
			this._webClient = new WebClient(opts.webClient);
		}
	}

	public static setWebClientFactory(value: () => WebClientLike) { WebApiClient._webClientFactory = value; }
	public static removeWebClientFactory() { delete WebApiClient._webClientFactory; }

	public get log() {
		if (this._log !== null) {
			return this._log;
		}
		this._log = loggerFactory.getLogger(this.constructor.name);
		if (this._webClient instanceof WebClient) {
			this._webClient.log = this._log;
		}
		return this._log;
	}
	public set log(value: LoggerLike) {
		if (this._webClient instanceof WebClient) {
			this._webClient.log = value;
		}
		this._log = value;
	}

	protected get baseUrl(): URL { return this._baseUrl; }

	protected invokeWebMethodGet(
		webMethodName: string,
		opts?: {
			queryArgs?: { [key: string]: string },
			headers?: http.OutgoingHttpHeaders,
			cancellationToken?: CancellationTokenLike
		}
	): Promise<any> {
		super.verifyNotDisposed();

		let path = webMethodName;
		let headers: http.OutgoingHttpHeaders | undefined;
		let cancellationToken: CancellationTokenLike | undefined;

		if (opts) {
			headers = opts.headers;
			cancellationToken = opts.cancellationToken;
			if (opts.queryArgs) {
				path += "?" + querystring.stringify(opts.queryArgs);
			}
		}

		return this.invokeGet(path, { headers, cancellationToken });
	}
	protected invokeWebMethodPost(
		webMethodName: string,
		opts?: {
			postArgs?: { [key: string]: string },
			headers?: http.OutgoingHttpHeaders,
			cancellationToken?: CancellationTokenLike
		}
	): Promise<any> {
		super.verifyNotDisposed();

		const bodyStr = opts && opts.postArgs && querystring.stringify(opts.postArgs);
		const body = bodyStr ? Buffer.from(bodyStr) : Buffer.alloc(0);

		let headers = {
			"Content-Type": "application/x-www-form-urlencoded",
			"Content-Length": body.byteLength
		};

		if (opts && opts.headers) {
			headers = { ...headers, ...opts.headers };
		}

		const cancellationToken = opts && opts.cancellationToken;

		return this.invokePost(webMethodName, body, { headers, cancellationToken });
	}
	protected async invokeGet(
		path: string,
		opts?: {
			headers?: http.OutgoingHttpHeaders,
			cancellationToken?: CancellationTokenLike
		}
	): Promise<any> {
		super.verifyNotDisposed();

		const cancellationToken = opts && opts.cancellationToken;

		let limitToken: LimitToken | null = null;
		if (this._limit !== undefined) {
			if (cancellationToken) {
				limitToken = await this._limit.instance.accrueTokenLazy(this._limit.timeout || 500, cancellationToken);
			} else {
				limitToken = await this._limit.instance.accrueTokenLazy(this._limit.timeout || 500);
			}
		}
		try {
			const url: URL = new URL(path, this._baseUrl);
			const headers = opts && opts.headers;

			const result = await this._webClient.invoke({ url, method: "GET", headers }, cancellationToken);

			return JSON.parse(result.toString());
		} finally {
			if (limitToken !== null) {
				limitToken.commit();
			}
		}
	}
	protected async invokePost(
		path: string,
		body: Buffer,
		opts?: {
			headers?: http.OutgoingHttpHeaders,
			cancellationToken?: CancellationTokenLike
		}): Promise<any> {
		super.verifyNotDisposed();

		const cancellationToken = opts && opts.cancellationToken;

		let limitToken: LimitToken | null = null;
		if (this._limit !== undefined) {
			if (cancellationToken) {
				limitToken = await this._limit.instance.accrueTokenLazy(this._limit.timeout || 500, cancellationToken);
			} else {
				limitToken = await this._limit.instance.accrueTokenLazy(this._limit.timeout || 500);
			}
		}
		try {
			const url: URL = new URL(path, this._baseUrl);
			const headers = opts && opts.headers;

			const result = await this._webClient.invoke({ url, method: "POST", body, headers }, cancellationToken);

			return JSON.parse(result.toString());
		} finally {
			if (limitToken !== null) {
				limitToken.commit();
			}
		}
	}

	protected async onDispose(): Promise<void> {
		if (this._limit !== undefined) {
			await this._limit.instance.dispose();
		}
	}
}

export default WebApiClient;
