export interface CreateUserRequestModel {
  confirmPassword: string;
  email: string;
  fullName: string;
  password: string;
  termsAccepted: boolean;
}

export interface SignInUserRequestModel {
  email: string;
  password: string;
}
