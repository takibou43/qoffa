/** أخطاء التطبيق — كلها تُترجم إلى استجابة JSON موحّدة */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'يجب تسجيل الدخول') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'ليست لديك صلاحية للقيام بهذه العملية') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'العنصر غير موجود') =>
  new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', message, details);

export const unprocessable = (message: string, details?: unknown) =>
  new AppError(422, 'UNPROCESSABLE', message, details);

export const tooMany = (message = 'عدد كبير من المحاولات، حاول لاحقًا') =>
  new AppError(429, 'TOO_MANY_REQUESTS', message);
