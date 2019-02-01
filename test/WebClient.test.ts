import { assert } from "chai";
import { URL } from "url";
import { Task, CancelledError } from "ptask.js";

import { WebClient, ProxyOpts } from "../src";

function nextTick() {
	return new Promise(resolve => process.nextTick(resolve));
}

describe("WebClient tests", function () {
	describe("Tests without proxy", function () {
		it("WebClient should GET http:", async function () {
			const httpClient = new WebClient();
			await httpClient.invoke({ url: new URL("?a", "http://www.google.com"), method: "GET", headers: { test: "test" } });
		});

		it("WebClient should GET https:", async function () {
			const httpClient = new WebClient();
			await httpClient.invoke({ url: new URL("?a", "http://www.google.com"), method: "GET", headers: { test: "test" } });
		});

		it("WebClient should cancel() invoke", async function () {
			const cts = Task.createCancellationTokenSource();

			let expectedError;
			let thenCalled = false;

			const httpClient = new WebClient();
			httpClient.invoke(
				{ url: new URL("?a", "http://www.google.com"), method: "GET", headers: { test: "test" } },
				cts.token
			)
				.then(() => { thenCalled = true; })
				.catch((reason) => { expectedError = reason; });

			await nextTick();
			cts.cancel();
			await nextTick();

			assert.isFalse(thenCalled);
			assert.isDefined(expectedError);
			assert.instanceOf(expectedError, CancelledError);
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
