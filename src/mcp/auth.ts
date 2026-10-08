import jwt from "jsonwebtoken";

export function validateToken(token: string): boolean {
  const secret = process.env.JWT_SECRET || "supersecret";
  try {
    jwt.verify(token, secret);
    return true;
  } catch {
    return false;
  }
}
