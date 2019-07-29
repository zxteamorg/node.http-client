# ZXTeam's Http Client
[![npm version badge](https://img.shields.io/npm/v/@zxteam/http-client.svg)](https://www.npmjs.com/package/@zxteam/http-client)
[![downloads badge](https://img.shields.io/npm/dm/@zxteam/http-client.svg)](https://www.npmjs.org/package/@zxteam/http-client)
[![commit activity badge](https://img.shields.io/github/commit-activity/m/zxteamorg/node.http-client)](https://github.com/zxteamorg/node.http-client/pulse)
[![last commit badge](https://img.shields.io/github/last-commit/zxteamorg/node.http-client)](https://github.com/zxteamorg/node.http-client/graphs/commit-activity)
[![twitter badge](https://img.shields.io/twitter/follow/zxteamorg?style=social&logo=twitter)](https://twitter.com/zxteamorg)

The package implements Http Client (wraps [Node.js](https://nodejs.org/) [http](https://nodejs.org/api/http.html)/[htts](https://nodejs.org/api/https.html) client request) as [InvokeChannel](https://github.com/zxteamorg/node.contract#invokechannel). Main idea of the wrapper is use single and more friendly Http Client in each of our project.

### Examples (TypeScript)
#### [Simple HTTP request: test/examples/typescript/example001.ts](test/examples/typescript/example001.ts)
```typescript
const cancellationToken: zxteam.CancellationToken = ...;

const httpClient = new HttpClient();

const request: HttpClient.Request = {
	url: new URL("http://httpbin.org/ip"),
	method: "GET",
	headers: { "Accept": "*/*" }
};

const response: HttpClient.Response = await httpClient.invoke(cancellationToken, request);

const statusCode: number = response.statusCode;
const statusMessage: string = response.statusMessage;
const headers: http.IncomingHttpHeaders = response.headers;
const body: Buffer = response.body;

console.log(statusCode);
console.log(statusMessage);
console.log(headers);
console.log(body.toString());
```
