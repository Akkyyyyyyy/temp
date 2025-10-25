export interface IForgotPasswordRequest {
  email: string;
  userType: 'company' | 'member';
}

export interface IVerifyOTPRequest {
  email: string;
  otp: string;
  token: string;
  userType: 'company' | 'member';
}

export interface IResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface IPasswordResetToken {
  email: string;
  otp: string;
  userType: 'company' | 'member';
  type: 'password_reset';
  iat: number;
  exp: number;
}

export interface IVerifiedResetToken {
  email: string;
  userType: 'company' | 'member';
  type: 'password_reset_verified';
  verifiedAt: number;
  iat: number;
  exp: number;
}
