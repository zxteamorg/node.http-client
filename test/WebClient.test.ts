import { assert } from "chai";
import { URL } from "url";
import { Task, CancelledError } from "ptask.js";

import WebClient from "../src/WebClient";
import { Socket, Server } from "net";
import * as http from "http";

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

		describe("Error handling tests", async function () {
			/*
				Possible socket errors:
					CommunicationError wraps following cases:
						- Refused,
						- DNS Resolve problem
						- Connection Timeout
						- Connection closed by server
						- etc
					WebError wraps HTTP errors

			 */


			it("Should handle Socket Refused as CommunicationError", async function () {
				const httpClient = new WebClient();
				let expectedError;
				try {
					await httpClient.invoke({ url: new URL("http://localhost:1"), method: "GET" });
				} catch (e) {
					expectedError = e;
				}
				assert.isDefined(expectedError);
				assert.instanceOf(expectedError, WebClient.CommunicationError);
				assert.instanceOf(expectedError.innerError, Error);
				assert.include(expectedError.innerError.message, "ECONNREFUSED");
			});
			it("Should handle DNS Resolve problem as CommunicationError", async function () {
				const httpClient = new WebClient();
				let expectedError;
				try {
					await httpClient.invoke({ url: new URL("http://not.exsting.domain.no"), method: "GET" });
				} catch (e) {
					expectedError = e;
				}
				assert.isDefined(expectedError);
				assert.instanceOf(expectedError, WebClient.CommunicationError);
				assert.instanceOf(expectedError.innerError, Error);
				assert.include(expectedError.innerError.message, "ENOTFOUND");
			});
			it("Should handle Connection Timeout (before connect) as CommunicationError", async function () {
				const httpClient = new WebClient({ timeout: 50 });
				let expectedError;
				try {
					// Connecting to NON existng IP to emulate connect timeout
					await httpClient.invoke({ url: new URL("http://192.168.255.255:65535"), method: "GET" });
				} catch (e) {
					expectedError = e;
				}
				assert.isDefined(expectedError);
				assert.instanceOf(expectedError, WebClient.CommunicationError);
				assert.instanceOf(expectedError.innerError, Error);
				assert.include(expectedError.innerError.message, "socket hang up");
			});
			it("Should handle Connection Timeout (after connect) as CommunicationError", async function () {
				const listeningDefer: any = {};
				listeningDefer.promise = new Promise(r => { listeningDefer.resolve = r; });
				const fakeServer = new Server();
				let serverSocket: any = null;
				fakeServer.on("connection", (socket) => {
					// Do nothing with socket. Emulate timeout after connect
					serverSocket = socket;
				});
				fakeServer.listen(65535, "127.0.0.1", () => {
					listeningDefer.resolve();
				});
				await listeningDefer.promise;
				try {
					const httpClient = new WebClient({ timeout: 50 });
					let expectedError;
					try {
						await httpClient.invoke({ url: new URL("http://127.0.0.1:65535"), method: "GET" });
					} catch (e) {
						expectedError = e;
					}
					assert.isDefined(expectedError);
					assert.instanceOf(expectedError, WebClient.CommunicationError);
					assert.instanceOf(expectedError.innerError, Error);
					assert.include(expectedError.innerError.message, "socket hang up");
				} finally {
					const closeDefer: any = {};
					closeDefer.promise = new Promise(r => { closeDefer.resolve = r; });
					fakeServer.close(() => closeDefer.resolve());
					if (serverSocket !== null) { (serverSocket as Socket).destroy(); }
					await closeDefer.promise;
				}
			});
			it("Should handle Connection closed by server as CommunicationError", async function () {
				const listeningDefer: any = {};
				listeningDefer.promise = new Promise(r => { listeningDefer.resolve = r; });
				const fakeServer = new Server();
				fakeServer.on("connection", (socket) => {
					setTimeout(() => socket.destroy(), 10);
				});
				fakeServer.listen(65535, "127.0.0.1", () => {
					listeningDefer.resolve();
				});
				await listeningDefer.promise;
				try {
					const httpClient = new WebClient({ timeout: 1000 });
					let expectedError;
					try {
						await httpClient.invoke({ url: new URL("http://127.0.0.1:65535"), method: "GET" });
					} catch (e) {
						expectedError = e;
					}
					assert.isDefined(expectedError);
					assert.instanceOf(expectedError, WebClient.CommunicationError);
					assert.instanceOf(expectedError.innerError, Error);
					assert.include(expectedError.innerError.code, "ECONNRESET");
				} finally {
					const closeDefer: any = {};
					closeDefer.promise = new Promise(r => { closeDefer.resolve = r; });
					fakeServer.close(() => closeDefer.resolve());
					await closeDefer.promise;
				}
			});
			it("Should handle HTTP 301 as WebError", async function () {
				const listeningDefer: any = {};
				listeningDefer.promise = new Promise(r => { listeningDefer.resolve = r; });
				const fakeServer = new http.Server((req, res) => {
					res.writeHead(301, "Fake moved");
					res.end("Fake data");
				});
				fakeServer.listen(65535, "127.0.0.1", () => {
					listeningDefer.resolve();
				});
				await listeningDefer.promise;
				try {
					const httpClient = new WebClient({ timeout: 500 });
					let expectedError;
					try {
						await httpClient.invoke({ url: new URL("http://127.0.0.1:65535"), method: "GET" });
					} catch (e) {
						expectedError = e;
					}
					assert.isDefined(expectedError);
					assert.instanceOf(expectedError, WebClient.WebError);
					assert.instanceOf(expectedError.errorData, Buffer);
					assert.equal(expectedError.errorData.toString(), "Fake data");
				} finally {
					const closeDefer: any = {};
					closeDefer.promise = new Promise(r => { closeDefer.resolve = r; });
					fakeServer.close(() => closeDefer.resolve());
					await closeDefer.promise;
				}
			});
			it("Should handle HTTP 404 as WebError", async function () {
				const listeningDefer: any = {};
				listeningDefer.promise = new Promise(r => { listeningDefer.resolve = r; });
				const fakeServer = new http.Server((req, res) => {
					res.writeHead(404, "Fake not found");
					res.end("Fake data");
				});
				fakeServer.listen(65535, "127.0.0.1", () => {
					listeningDefer.resolve();
				});
				await listeningDefer.promise;
				try {
					const httpClient = new WebClient({ timeout: 500 });
					let expectedError;
					try {
						await httpClient.invoke({ url: new URL("http://127.0.0.1:65535"), method: "GET" });
					} catch (e) {
						expectedError = e;
					}
					assert.isDefined(expectedError);
					assert.instanceOf(expectedError, WebClient.WebError);
					assert.instanceOf(expectedError.errorData, Buffer);
					assert.equal(expectedError.errorData.toString(), "Fake data");
				} finally {
					const closeDefer: any = {};
					closeDefer.promise = new Promise(r => { closeDefer.resolve = r; });
					fakeServer.close(() => closeDefer.resolve());
					await closeDefer.promise;
				}
			});
		});
	});

	describe.skip("Tests with proxy", function () {
		const proxyOpts: WebClient.ProxyOpts = {
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