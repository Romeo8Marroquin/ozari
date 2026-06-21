export const nodeEnv = process.env["NODE_ENV"] ?? "development";
export const appEnv = process.env["APP_ENV"] ?? nodeEnv;

export const isProductionEnvironment = nodeEnv === "production";
export const isStagingEnvironment = nodeEnv === "staging";
export const isDeployedEnvironment = isProductionEnvironment || isStagingEnvironment;
