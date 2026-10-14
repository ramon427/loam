import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { webReadTool } from "../ai/webRead";

/** Addresses the tests treat as public, so a local server can stand in for a site. */
const network = { allowed: new Set<string>() };

vi.mock("../ai/publicAddress", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ai/publicAddress")>();
  return {
    isPublicAddress: (address: string) =>
      network.allowed.has(address) || actual.isPublicAddress(address),
  };
});

const servers: Server[] = [];
afterEach(async () => {
  network.allowed.clear();
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

/** A site on 127.0.0.1 answering with `handle`; returns its address. */
const site = async (handle: Parameters<typeof createServer>[1]) => {
  const server = createServer(handle);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const read = (url: string) =>
  webReadTool.run({ url }) as Promise<{ result: { url: string; title: string; text: string } }>;

describe("public addresses", () => {
  it("refuses this computer, local networks and the IPv4 addresses IPv6 carries", async () => {
    const { isPublicAddress: check } =
      await vi.importActual<typeof import("../ai/publicAddress")>("../ai/publicAddress");
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::",
      "::1",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:192.168.0.1",
      "64:ff9b::a00:1",
      "2002:c0a8:101::1",
      "not an address",
    ])
      expect(check(address), address).toBe(false);
    for (const address of ["93.184.215.14", "1.1.1.1", "2606:4700::1111", "::ffff:1.1.1.1"])
      expect(check(address), address).toBe(true);
  });
});

describe("reading a web page", () => {
  it("reads a page's title and text", async () => {
    const url = await site((_request, response) => {
      response.setHeader("content-type", "text/html");
      response.end("<title>Hello</title><p>World</p>");
    });
    network.allowed.add("127.0.0.1");
    const { result } = await read(url);
    expect(result).toMatchObject({ title: "Hello", text: expect.stringContaining("World") });
  });

  it("refuses this computer and its local network, by address or by name", async () => {
    const url = await site((_request, response) => response.end("private"));
    await expect(read(url)).rejects.toThrow("only public web pages");
    await expect(read(url.replace("127.0.0.1", "localhost"))).rejects.toThrow(
      "only public web pages",
    );
    await expect(read("http://[::ffff:127.0.0.1]/")).rejects.toThrow("only public web pages");
    await expect(read("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      "only public web pages",
    );
  });

  it("checks every address a redirect leads to, and stops after a few", async () => {
    const url = await site((request, response) => {
      const to =
        request.url === "/private" ? "http://192.168.0.1/admin" : `/hop${request.url!.length}`;
      response.writeHead(302, { location: to }).end();
    });
    network.allowed.add("127.0.0.1");
    await expect(read(`${url}/private`)).rejects.toThrow("only public web pages");
    await expect(read(url)).rejects.toThrow("redirects too many times");
  });

  it("reads no more than 5 MB of a page", async () => {
    let sent = 0;
    const url = await site((_request, response) => {
      response.setHeader("content-type", "text/plain");
      const chunk = "a".repeat(1024 * 1024);
      const write = () => {
        // A page that never ends.
        while (sent < 50 * 1024 * 1024 && response.write(chunk)) sent += chunk.length;
        response.once("drain", write);
      };
      write();
      response.on("close", () => response.removeAllListeners("drain"));
    });
    network.allowed.add("127.0.0.1");
    const { result } = await read(url);
    expect(result.text.length).toBeLessThanOrEqual(60_000 + 20);
    expect(sent).toBeLessThan(20 * 1024 * 1024);
  });
});
