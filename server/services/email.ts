import { env } from '../env.ts';

// Sends a plain-text email through Resend when RESEND_API_KEY is configured.
// Without a key it does nothing and returns false. It never throws, so a mail failure cannot
// roll back the business action that triggered it.
export async function sendEmail(to: string | null | undefined, subject: string, text: string): Promise<boolean> {
  if (!env.resendApiKey || !to) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: env.emailFrom, to: [to], subject, text }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn(`[StockSense Email] Resend returned ${res.status} for "${subject}".`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[StockSense Email] Send failed:', err.message);
    return false;
  }
}
