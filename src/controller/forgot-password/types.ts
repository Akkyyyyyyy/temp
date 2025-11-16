export interface IForgotPasswordRequest {
  email: string;
}

export interface IVerifyOTPRequest {
  email: string;
  otp: string;
  token: string;
}

export interface IResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface IPasswordResetToken {
  email: string;
  otp: string;
  type: 'password_reset';
  iat: number;
  exp: number;
}

export interface IVerifiedResetToken {
  email: string;
  type: 'password_reset_verified';
  verifiedAt: number;
  iat: number;
  exp: number;
}
