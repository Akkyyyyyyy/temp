import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
const tokenSecret = process.env.JWT_SECRET;

if (!tokenSecret) {
  console.error("SECRET_KEY not set!");
}

const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    if (!tokenSecret) {
    return res.status(500).json({
      message: "Server configuration error",
    });
  }
  

  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.startsWith("Bearer ") 
    ? authHeader.slice(7) 
    : null;

  if (!token) {
    return res.status(401).json({
      message: "Access token required",
    });
  }

  try {
    const decodedToken = jwt.verify(token, tokenSecret);
    res.locals.token = decodedToken;
    next();
  } catch (error) {
     if (error instanceof jwt.JsonWebTokenError) {
      return res.status(498).json({
        message: "Token expired",
      });
    }
    
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(498).json({
        message: "Token expired",
      });
    }

    // Generic error for other cases
    console.error("JWT verification error:", error);
    return res.status(403).json({
      message: "Authentication failed",
    });
  }
};

export default authMiddleware;
