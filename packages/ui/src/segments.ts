// parte un texto en torno al token {email} para renderizarlo como enlace mailto
// sin meter html en el copy declarativo. compartido por PrivacyPolicy y Support.
export interface EmailSegment {
  kind: 'text' | 'email';
  value: string;
}

export function emailSegments(text: string, email: string): EmailSegment[] {
  return text
    .split(/(\{email\})/)
    .filter(Boolean)
    .map((chunk) => (chunk === '{email}' ? { kind: 'email' as const, value: email } : { kind: 'text' as const, value: chunk }));
}
