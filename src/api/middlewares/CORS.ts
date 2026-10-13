import { NextFunction, Request, Response } from "express";

export const EMBEDDABLE_CONTENT_SECURITY_POLICY =
    "default-src *  data: blob: filesystem: about: ws: wss: 'unsafe-inline' 'unsafe-eval'; script-src * data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src * data: blob: 'unsafe-inline'; img-src * data: blob: 'unsafe-inline'; frame-src * data: blob: ; style-src * data: blob: 'unsafe-inline'; font-src * data: blob: 'unsafe-inline';";

export function CORS(req: Request, res: Response, next: NextFunction) {
    res.set("Access-Control-Allow-Credentials", "true");
    res.set("Access-Control-Allow-Headers", req.header("Access-Control-Request-Headers") || "*");
    res.set("Access-Control-Allow-Methods", req.header("Access-Control-Request-Method") || "*");
    res.set("Access-Control-Allow-Origin", req.header("Origin") ?? "*");
    res.set("Access-Control-Max-Age", "60"); // dont make it too long so we can change it dynamically
    res.set("Content-security-policy", `${EMBEDDABLE_CONTENT_SECURITY_POLICY} frame-ancestors 'self';`);
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "strict-origin-when-cross-origin");
    if (req.secure) res.set("Strict-Transport-Security", "max-age=31536000");

    if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
    }
    next();
}
