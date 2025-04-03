import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
// enable import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
// enable import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
// enable import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
// enable import { WinstonInstrumentation } from '@opentelemetry/instrumentation-winston';
// enable import { resourceFromAttributes } from '@opentelemetry/resources';
// enable import { NodeSDK } from '@opentelemetry/sdk-node';
// enable import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

// enable const otlpExporter = new OTLPTraceExporter({
//   url: process.env.OTLP_URL,
// });

// enable const openTelemetrySdk = new NodeSDK({
//   instrumentations: [
//     new ExpressInstrumentation(),
//     new HttpInstrumentation(),
//     new WinstonInstrumentation(),
//   ],
//   resource: resourceFromAttributes({
//     [ATTR_SERVICE_NAME]: 'ozari-api',
//   }),
//   // metricReader: new PeriodicExportingMetricReader({
//   //   exporter: new ConsoleMetricExporter(),
//   // }),
//   traceExporter: otlpExporter,
// });

// enable openTelemetrySdk.start();
