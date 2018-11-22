import { assert } from "chai";
import { URL } from "url";

import { WebClient, ProxyOpts } from "../src";

describe("WebClient tests", function () {
	describe("Tests without proxy", function () {
		it("WebClient should GET http:", async function () {
			const httpClient = new WebClient({});
			await httpClient.invoke({ url: new URL("?a", "http://www.google.com"), method: "GET", headers: { test: "test" } });
		});

		it("WebClient should GET https:", async function () {
			const httpClient = new WebClient({});
			await httpClient.invoke({ url: new URL("?a", "http://www.google.com"), method: "GET", headers: { test: "test" } });
		});
	});

	describe.skip("Tests with proxy", function () {
		const proxyOpts: ProxyOpts = {
			type: "http",
			host: "localhost",
			port: 3128
		};
		it("WebClient should GET http: with proxy", async function () {
			const httpClient = new WebClient({ proxyOpts });
			const res = await httpClient.invoke({ method: "GET", url: new URL("http://www.google.com?a"), headers: { test: "test" } });
		});

		it("WebClient should GET https: with proxy", async function () {
			const httpClient = new WebClient({ proxyOpts });
			const res = await httpClient.invoke({ method: "GET", url: new URL("http://www.google.com?a"), headers: { test: "test" } });
		});

		it("WebClient should GET data from Poloniex: with proxy", async function () {
			const httpClient = new WebClient({ proxyOpts });
			const res = await httpClient.invoke({
				method: "GET",
				url: new URL("https://poloniex.com/public?command=returnTicker")
			});
			assert.hasAnyKeys(JSON.parse(res.toString()), ["BTC_BCN", "BTC_ZEC", "ETH_ZEC"]);
		});
	});
});
