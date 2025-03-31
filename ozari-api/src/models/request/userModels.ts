export interface CreateUserRequestModel {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  termsAccepted: boolean;
}

export interface SignInUserRequestModel {
  email: string;
  password: string;
}
