import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { env } from '../env.ts';

// Every AI call is bounded by this timeout. On failure the caller falls back to a non-AI path
// (manual entry or a template string), so AI can never block a user.
const AI_TIMEOUT_MS = 20000;

export const extractionSchema = z.object({
  invoice_number: z.string().nullable().optional(),
  invoice_date: z.string().nullable().optional(),
  supplier_name: z.string().nullable().optional(),
  items: z.array(
    z.object({
      description: z.string(),
      quantity: z.coerce.number(),
      unit_price: z.coerce.number(),
      line_total: z.coerce.number().nullable().optional(),
      po_item_id: z.coerce.number().nullable().optional(),
      confidence: z.coerce.number().min(0).max(1).nullable().optional(),
    })
  ),
  subtotal: z.coerce.number().nullable().optional(),
  tax: z.coerce.number().nullable().optional(),
  total: z.coerce.number().nullable().optional(),
});

export type Extraction = z.infer<typeof extractionSchema>;

export interface PoLineForAi {
  id: number;
  description: string;
  quantity: number;
  unit_price: number;
}

export type AiOutcome<T> = { ok: true; value: T; source: 'gemini' | 'mock' } | { ok: false; reason: string };

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The AI service did not respond in time.')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function stripCodeFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function mockExtraction(lines: PoLineForAi[]): Extraction {
  // The mock prices the first line 8% above the PO so the discrepancy flag is visible in demos and tests.
  const items = lines.map((line, index) => {
    const unitPrice = index === 0 ? Math.round(line.unit_price * 1.08 * 100) / 100 : line.unit_price;
    return {
      description: line.description,
      quantity: line.quantity,
      unit_price: unitPrice,
      line_total: Math.round(line.quantity * unitPrice * 100) / 100,
      po_item_id: line.id,
      confidence: 0.95,
    };
  });
  const subtotal = Math.round(items.reduce((sum, item) => sum + item.line_total, 0) * 100) / 100;
  return {
    invoice_number: 'MOCK-INV-0001',
    invoice_date: new Date().toISOString().slice(0, 10),
    supplier_name: null,
    items,
    subtotal,
    tax: 0,
    total: subtotal,
  };
}

// Reads a supplier invoice (image or PDF) into structured fields. The model is only asked to read;
// all comparison against the PO is done in code afterwards.
export async function extractInvoice(file: { buffer: Buffer; mimeType: string }, poLines: PoLineForAi[]): Promise<AiOutcome<Extraction>> {
  if (env.aiMock) return { ok: true, value: mockExtraction(poLines), source: 'mock' };
  if (!env.geminiApiKey) {
    return { ok: false, reason: 'AI extraction is not configured (GEMINI_API_KEY is not set). Enter the invoice details manually.' };
  }

  const lines = poLines.map((line) => `- id ${line.id}: ${line.description}, quantity ${line.quantity}, unit price ${line.unit_price}`).join('\n');
  const prompt = [
    'Extract the supplier invoice in the attachment. Reply with strict JSON only, no commentary, matching this shape:',
    '{"invoice_number": string, "invoice_date": "YYYY-MM-DD", "supplier_name": string, "items": [{"description": string, "quantity": number, "unit_price": number, "line_total": number, "po_item_id": number or null, "confidence": number between 0 and 1}], "subtotal": number, "tax": number, "total": number}',
    'Never invent items that are not on the invoice. Set po_item_id to the id of the matching purchase order line below, or null if none matches.',
    'Purchase order lines:',
    lines || '(none)',
  ].join('\n');

  try {
    const client = new GoogleGenAI({ apiKey: env.geminiApiKey });
    const response = await withTimeout(
      client.models.generateContent({
        model: env.geminiModel,
        contents: [
          {
            role: 'user',
            parts: [{ inlineData: { mimeType: file.mimeType, data: file.buffer.toString('base64') } }, { text: prompt }],
          },
        ],
        config: { responseMimeType: 'application/json' },
      }),
      AI_TIMEOUT_MS
    );
    const parsed = extractionSchema.safeParse(JSON.parse(stripCodeFence(response.text ?? '')));
    if (!parsed.success) {
      return { ok: false, reason: 'The AI reply could not be read. Enter the invoice details manually.' };
    }
    return { ok: true, value: parsed.data, source: 'gemini' };
  } catch (err: any) {
    return { ok: false, reason: `AI extraction failed (${err.message}). Enter the invoice details manually.` };
  }
}

// Short text generation for summaries and drafts. `fallback` is used whenever AI is off or fails.
export async function generateText(prompt: string, fallback: string): Promise<{ text: string; source: 'gemini' | 'template' }> {
  if (env.aiMock || !env.geminiApiKey) return { text: fallback, source: 'template' };
  try {
    const client = new GoogleGenAI({ apiKey: env.geminiApiKey });
    const response = await withTimeout(
      client.models.generateContent({ model: env.geminiModel, contents: prompt }),
      AI_TIMEOUT_MS
    );
    const text = (response.text ?? '').trim();
    return text ? { text, source: 'gemini' } : { text: fallback, source: 'template' };
  } catch {
    return { text: fallback, source: 'template' };
  }
}
