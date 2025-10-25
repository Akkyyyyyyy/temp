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