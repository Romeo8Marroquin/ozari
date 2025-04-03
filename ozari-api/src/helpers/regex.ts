export const fullNameRegex = /^(?=.{5,255}$)[A-Za-zÀ-ÖØ-öø-ÿ0-9\s'-]+$/;

export const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export const passwordRegex =
  /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*_\-+=?,:;])[A-Za-z\d!@#$%^&*_\-+=?,:;]{10,25}$/;

export const genericUuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
