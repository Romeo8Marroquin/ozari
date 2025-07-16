export interface LoginResponseInterface {
  token: string;
  user: {
    id: string;
    name: string;
    role: string;
  };
}
