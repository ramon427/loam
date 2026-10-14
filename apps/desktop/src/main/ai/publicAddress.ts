import { isIPv4, isIPv6 } from "node:net";

/** An IPv4 address's four bytes. */
const ipv4Bytes = (address: string) => address.split(".").map(Number);

/** An IPv6 address's sixteen bytes, with an embedded IPv4 tail ("::ffff:1.2.3.4") expanded. */
const ipv6Bytes = (address: string) => {
  let text = address.toLowerCase().replace(/%.*$/, "");
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1];
  if (tail) {
    const [a, b, c, d] = ipv4Bytes(tail) as [number, number, number, number];
    text = `${text.slice(0, -tail.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", rest] = text.split("::");
  const groups = (part: string | undefined) => (part ? part.split(":") : []);
  const missing = 8 - groups(head).length - groups(rest).length;
  const all =
    rest === undefined
      ? groups(head)
      : [...groups(head), ...Array<string>(missing).fill("0"), ...groups(rest)];
  return all.flatMap((group) => {
    const value = parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
};

const isPublicIpv4 = ([a = 0, b = 0, c = 0]: number[]) =>
  !(
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b < 128) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b < 32) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) || // protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );

/**
 * Whether an IP address is on the public internet: not this computer, its
 * local network, link-local, carrier-grade NAT, multicast or reserved. IPv6
 * addresses that carry an IPv4 address are judged by that address.
 */
export const isPublicAddress = (address: string): boolean => {
  if (isIPv4(address)) return isPublicIpv4(ipv4Bytes(address));
  if (!isIPv6(address)) return false;
  const bytes = ipv6Bytes(address);
  const zeros = (count: number) => bytes.slice(0, count).every((byte) => byte === 0);
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::a.b.c.d).
  if (zeros(10) && bytes[10] === 0xff && bytes[11] === 0xff) return isPublicIpv4(bytes.slice(12));
  if (zeros(12)) return bytes.slice(12).some(Boolean) && isPublicIpv4(bytes.slice(12));
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b)
    return isPublicIpv4(bytes.slice(12));
  // 6to4 carries its IPv4 address in bytes 2 to 5.
  if (bytes[0] === 0x20 && bytes[1] === 0x02 && !isPublicIpv4(bytes.slice(2, 6))) return false;
  const [first = 0, second = 0] = bytes;
  return !(
    (first & 0xfe) === 0xfc || // unique local
    (first === 0xfe && (second & 0xc0) === 0x80) || // link-local
    (first === 0xfe && (second & 0xc0) === 0xc0) || // site-local
    first === 0xff // multicast
  );
};
