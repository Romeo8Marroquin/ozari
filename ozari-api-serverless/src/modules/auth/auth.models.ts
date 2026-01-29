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
  deviceUuid: string;
}

export interface GetAllUsersResponseModel {
  createdAt: Date;
  email: string | undefined;
  fullName: string | undefined;
  id: number;
  role: string | undefined;
  updatedAt?: Date;
}
