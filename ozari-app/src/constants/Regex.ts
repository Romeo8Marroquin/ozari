export const SYMBOLS = '!@#$%^&*_-+=?,:;';

export const UPPER_REGEX = /[A-Z]/;
export const LOWER_REGEX = /[a-z]/;
export const NUMBER_REGEX = /\d/;
export const SAFE_SYMBOL_REGEX = /[!@#$%^&*_\-+=?,:;]/;

export const UNSAFE_SYMBOL_REGEX = /[^A-Za-z0-9!@#$%^&*_\-+=?,:;]/;

export const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*_\-+=?,:;])[A-Za-z\d!@#$%^&*_\-+=?,:;]{10,128}$/;
