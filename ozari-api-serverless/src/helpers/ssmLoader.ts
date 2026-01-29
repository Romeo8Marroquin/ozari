import { SSMProvider } from '@aws-lambda-powertools/parameters/ssm';
import { SSMClientConfig } from '@aws-sdk/client-ssm';
import { logger } from '@deps/winstonConfig';
import i18next from 'i18next';

const clientConfiguration: SSMClientConfig = {
  region: process.env.AWS_REGION ?? 'us-east-1',
};

const ssmProvider = new SSMProvider({
  clientConfig: clientConfiguration,
});

export async function getSecret(name: string): Promise<string> {
  const stage = process.env.API_ENV ?? 'dev';
  const ssmPath = `/ozari/${stage}/${name.toLowerCase()}`;

  try {
    const secret = await ssmProvider.get(ssmPath, {
      maxAge: 300,
      decrypt: true,
    });

    if (!secret) throw new Error(i18next.t('api.ssm.ssmFetchError'));
    return secret;
  } catch (error) {
    logger.error(i18next.t('api.ssm.logs.ssmFetchError', { ssmPath }), error);
    throw new Error(i18next.t('api.ssm.ssmFetchError'));
  }
}
