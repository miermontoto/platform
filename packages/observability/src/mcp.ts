// operaciones de un servidor mcp con la semconv de mcp de opentelemetry: un span SERVER por petición
// llamado `{mcp.method.name} {target}` (`tools/call duckhunt-search`), con gen_ai.tool.name y
// error.type (tool_error si la herramienta devuelve isError, el nombre del error si lanza), y su
// duración en el histograma mcp.server.operation.duration. dentro de una request http (transporte
// streamable) cuelga de ella; por stdio no hay traza activa y es la raíz.
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { defineHistogram } from './metrics.js';
import { withSpan } from './tracing.js';

const MS_PER_S = 1000;
const TOOL_ERROR = 'tool_error';
const TOOL_OPERATION = 'execute_tool';
// una herramienta va de una lectura de milisegundos a una búsqueda o un agente de minutos
const MCP_BUCKETS_S = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300];

const mcpDuration = defineHistogram('mcp.server.operation.duration', {
  unit: 's',
  description: 'duración de las peticiones mcp servidas, por método y herramienta',
  advice: { explicitBucketBoundaries: MCP_BUCKETS_S },
});

export interface McpOperation {
  // método json-rpc: tools/call, prompts/get, tools/list...
  method: string;
  // herramienta o prompt (target del nombre del span)
  tool?: string;
  sessionId?: string;
  requestId?: string | number;
}

const isToolError = (result: unknown): boolean => typeof result === 'object' && result !== null && (result as { isError?: unknown }).isError === true;

/** ejecuta una petición mcp dentro de su span y registra su duración y resultado. propaga lo que lance. */
export function traceMcpOperation<T>({ method, tool, sessionId, requestId }: McpOperation, fn: () => Promise<T>): Promise<T> {
  // baja cardinalidad: span y métrica. la sesión y el id de petición, solo al span
  const labels = { 'mcp.method.name': method, ...(tool && { 'gen_ai.tool.name': tool, 'gen_ai.operation.name': TOOL_OPERATION }) };
  return withSpan(
    tool ? `${method} ${tool}` : method,
    async (span) => {
      span.setAttributes({ ...labels, ...(sessionId && { 'mcp.session.id': sessionId }), ...(requestId !== undefined && { 'jsonrpc.request.id': String(requestId) }) });
      const start = performance.now();
      let errorType: string | undefined;
      try {
        const result = await fn();
        if (isToolError(result)) {
          errorType = TOOL_ERROR;
          span.setStatus({ code: SpanStatusCode.ERROR, message: TOOL_ERROR });
        }
        return result;
      } catch (err) {
        errorType = err instanceof Error ? err.name : 'Error';
        throw err;
      } finally {
        if (errorType) span.setAttribute('error.type', errorType);
        mcpDuration.record((performance.now() - start) / MS_PER_S, { ...labels, ...(errorType && { 'error.type': errorType }) });
      }
    },
    { kind: SpanKind.SERVER, root: !trace.getActiveSpan() },
  );
}
