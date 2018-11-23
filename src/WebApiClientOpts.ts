import { Limit } from "limit.js";

import { ProxyOpts, WebClientLike } from "./WebClient";

export interface WebApiClientOpts {
	url: string;
	invokeTimeout?: number;
	proxy?: ProxyOpts;
	limit?: Limit;
	webClient?: WebClientLike;
}

export default WebApiClientOpts;
