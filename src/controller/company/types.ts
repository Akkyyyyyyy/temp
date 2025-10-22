export interface IRegisterCompanyRequest {
    name: string;
    email: string;
    country: string;
    password: string;
}

export interface IRegisterCompanyResponse {
    message: string;
}

export interface ILoginCompanyRequest {
    email: string;
    password: string;
}
export interface ILoginCompanyResponse {
    message: string;
    token?: string;
    companyDetails?:ICompanyDetails;
}
export interface ICompanyDetails {
    id: string;
    name: string;
    email: string;
    country: string;
}

export interface IForgotPasswordRequest {
  email: string;
}

export interface IVerifyOTPRequest {
  email: string;
  otp: string;
  token: string; // Add token to verify OTP request
}

export interface IResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface IPasswordResetToken {
    email: string;
    otp: string; // Include OTP in the token payload
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