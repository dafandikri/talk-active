export class ApiProblem extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly headers: HeadersInit | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    retryable = false,
    headers?: HeadersInit,
  ) {
    super(message);
    this.name = 'ApiProblem';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.headers = headers;
  }
}
