export type AppErrorCode = 'CONFIG_INVALID' | 'CONFIG_MISSING' | 'SOURCE_FETCH_FAILED';

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
