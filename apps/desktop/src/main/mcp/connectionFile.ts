import { z } from "zod";

/** Where AI clients reach the app's MCP server: this computer only. */
export const connectionUrl = (port: number) => `http://127.0.0.1:${port}/mcp`;

const isConnectionUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.href === connectionUrl(Number(url.port));
  } catch {
    return false;
  }
};

/** The bearer key AI clients send. */
export const connectionTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * `mcp-connection.json`: the app writes it, and the stdio connector reads it
 * to forward a client's requests to the running app.
 */
export const connectionFileSchema = z.object({
  url: z
    .string()
    .refine(isConnectionUrl, "The connection configuration must point to Loam on 127.0.0.1."),
  token: connectionTokenSchema,
});

export type ConnectionFile = z.infer<typeof connectionFileSchema>;
