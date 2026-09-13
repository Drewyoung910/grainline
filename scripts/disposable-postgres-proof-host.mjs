import { isIP } from "node:net";

// Client URLs must still target numeric loopback. GitHub's published Docker
// port can report the private container address through inet_server_addr().
export function proofServerHostAccepted(host, githubActions = false) {
  if (host === "127.0.0.1") return true;
  if (!githubActions || typeof host !== "string" || isIP(host) !== 4) return false;
  const octets = host.split(".").map(Number);
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}
