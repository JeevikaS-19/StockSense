import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db, withTransaction } from '../db.ts';
import { fail } from '../errors.ts';
import { asyncHandler, parse } from '../middleware/validate.ts';
import { assertLabAccess, isAdmin, requireAuth, type AuthRequest } from '../middleware/auth.ts';
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrderRow,
  getPurchaseOrderDetail,
  listPurchaseOrders,
  addLines,
  rejectPurchaseOrder,
  replaceDraftLines,
  sendPurchaseOrder,
  submitPurchaseOrder,
} from '../services/purchaseOrders.ts';
import { receiveGoods, getReceipt, REJECT_REASONS } from '../services/receiving.ts';
import { reviewInvoice, updateInvoiceLines, loadInvoice, type InvoiceHeader } from '../services/invoices.ts';
import { uploadInvoice, INVOICE_MAX_BYTES } from '../services/invoiceUpload.ts';
import { supplierPortalUrl, emailSupplierAboutPo } from '../services/supplierEmail.ts';

export const purchaseOrdersRouter = Router();
export const receiptsRouter = Router();
export const invoicesRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: INVOICE_MAX_BYTES, files: 1 } });

const lineSchema = z.object({
  product_id: z.coerce.number().int().positive('Choose a product for every line'),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unit_price: z.coerce.number().min(0, 'Unit price cannot be negative.').optional(),
});

const createSchema = z.object({
  lab_id: z.coerce.number().int().positive('Laboratory is required'),
  supplier_id: z.coerce.number().int().positive('Choose a supplier'),
  notes: z.string().trim().max(1000).optional().default(''),
  lines: z.array(lineSchema).min(1, 'Add at least one item'),
});

const updateSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(lineSchema).min(1, 'Add at least one item'),
});

const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason (at least 3 characters).') });

const approveSchema = z.object({
  override: z.boolean().optional().default(false),
  reason: z.string().trim().optional(),
});

const receiptSchema = z.object({
  delivery_reference: z.string().trim().min(1, 'Enter the delivery challan or invoice number'),
  received_at: z.string().optional().nullable(),
  note: z.string().trim().max(1000).optional().default(''),
  lines: z.array(
    z.object({
      po_item_id: z.coerce.number().int().positive(),
      qty_accepted: z.coerce.number().min(0),
      qty_rejected: z.coerce.number().min(0),
      reject_reason: z.enum(REJECT_REASONS).nullable().optional(),
      note: z.string().trim().optional().default(''),
    })
  ),
});

const invoiceEditSchema = z.object({
  invoice_number: z.string().trim().max(60).default(''),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  tax: z.coerce.number().min(0).default(0),
  total: z.coerce.number().min(0).nullable().optional(),
  items: z.array(
    z.object({
      po_item_id: z.coerce.number().int().positive().nullable().optional(),
      description: z.string().trim().min(1, 'Describe each invoice line'),
      quantity: z.coerce.number().min(0),
      unit_price: z.coerce.number().min(0),
      line_total: z.coerce.number().min(0).nullable().optional(),
    })
  ),
});

async function poLabId(id: number): Promise<number> {
  const res = await db.query<{ lab_id: number }>('SELECT lab_id FROM purchase_orders WHERE id = $1', [id]);
  if (res.rows.length === 0) fail(404, 'NOT_FOUND', 'Purchase order not found.');
  return Number(res.rows[0].lab_id);
}

async function requirePoAccess(req: AuthRequest, poId: number): Promise<number> {
  const labId = await poLabId(poId);
  await assertLabAccess(req.user!, labId);
  return labId;
}

function requireAdminFor(req: AuthRequest) {
  if (!isAdmin(req.user!)) fail(403, 'FORBIDDEN', 'Only the administrator can do this.');
}

function supplierLink(token: string) {
  return supplierPortalUrl(token);
}

// GET /api/purchase-orders?lab_id=&status=&supplier_id=
purchaseOrdersRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    let labIds: number[] | null = null;
    if (req.query.lab_id) {
      const labId = Number(req.query.lab_id);
      await assertLabAccess(req.user!, labId);
      labIds = [labId];
    } else if (!isAdmin(req.user!)) {
      const mine = await db.query('SELECT lab_id FROM lab_members WHERE user_id = $1', [req.user!.id]);
      labIds = mine.rows.map((row) => Number(row.lab_id));
    }
    const orders = await listPurchaseOrders(db, {
      labIds,
      status: req.query.status ? String(req.query.status) : undefined,
      supplierId: req.query.supplier_id ? Number(req.query.supplier_id) : undefined,
    });
    res.json({ purchase_orders: orders });
  })
);

// POST /api/purchase-orders - a manual draft (staff and admin).
purchaseOrdersRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = parse(createSchema, req.body);
    await assertLabAccess(req.user!, body.lab_id);
    const poId = await withTransaction(async (tx) => {
      const po = await createPurchaseOrderRow(tx, {
        labId: body.lab_id,
        supplierId: body.supplier_id,
        createdBy: req.user!.id,
        source: 'manual',
        notes: body.notes,
      });
      await addLines(tx, po, body.lines, req.user!.id);
      return Number(po.id);
    });
    res.status(201).json({ purchase_order: await getPurchaseOrderDetail(db, poId) });
  })
);

// GET /api/purchase-orders/:id
purchaseOrdersRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    await requirePoAccess(req, id);
    const detail = await getPurchaseOrderDetail(db, id);
    res.json({ purchase_order: { ...detail, supplier_link: supplierLink(detail.supplier_token) } });
  })
);

// PUT /api/purchase-orders/:id - edits a draft only.
purchaseOrdersRouter.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    await requirePoAccess(req, id);
    const body = parse(updateSchema, req.body);
    await withTransaction(async (tx) => {
      await replaceDraftLines(tx, id, body.lines, req.user!.id);
      if (body.notes !== undefined) {
        await tx.query('UPDATE purchase_orders SET notes = $1, updated_at = NOW() WHERE id = $2', [body.notes, id]);
      }
    });
    res.json({ purchase_order: await getPurchaseOrderDetail(db, id) });
  })
);

purchaseOrdersRouter.post(
  '/:id/submit',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    await requirePoAccess(req, id);
    await withTransaction((tx) => submitPurchaseOrder(tx, id, req.user!.id));
    res.json({ purchase_order: await getPurchaseOrderDetail(db, id) });
  })
);

// Approval is the administrator's decision; an override over budget needs a written reason.
purchaseOrdersRouter.post(
  '/:id/approve',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    requireAdminFor(req);
    const id = Number(req.params.id);
    await requirePoAccess(req, id);
    const body = parse(approveSchema, req.body ?? {});
    await withTransaction((tx) => approvePurchaseOrder(tx, id, req.user!.id, { override: body.override, reason: body.reason }));
    res.json({ purchase_order: await getPurchaseOrderDetail(db, id) });
  })
);

purchaseOrdersRouter.post(
  '/:id/reject',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    requireAdminFor(req);
    const id = Number(req.params.id);
    await requirePoAccess(req, id);
    const body = parse(reasonSchema, req.body);
    await withTransaction((tx) => rejectPurchaseOrder(tx, id, req.user!.id, body.reason));
    res.json({ purchase_order: await getPurchaseOrderDetail(db, id) });
  })
);

// Drafts and pending orders can be cancelled by any lab member; approved orders need the administrator.
purchaseOrdersRouter.post(
  '/:id/cancel',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    await requirePoAccess(req, id);
    const body = parse(reasonSchema, req.body);
    const current = await db.query<{ status: string }>('SELECT status FROM purchase_orders WHERE id = $1', [id]);
    if (current.rows[0].status === 'approved') requireAdminFor(req);
    await withTransaction((tx) => cancelPurchaseOrder(tx, id, req.user!.id, body.reason));
    res.json({ purchase_order: await getPurchaseOrderDetail(db, id) });
  })
);

purchaseOrdersRouter.post(
  '/:id/send',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    requireAdminFor(req);
    const id = Number(req.params.id);
    await requirePoAccess(req, id);
    await withTransaction((tx) => sendPurchaseOrder(tx, id, req.user!.id));
    await emailSupplierAboutPo(db, id).catch(() => false);
    res.json({ purchase_order: await getPurchaseOrderDetail(db, id) });
  })
);

purchaseOrdersRouter.post(
  '/:id/close',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    requireAdminFor(req);
    const id = Number(req.params.id);
    await requirePoAccess(req, id);
    const body = parse(reasonSchema, req.body);
    await withTransaction((tx) => closePurchaseOrder(tx, id, req.user!.id, body.reason));
    res.json({ purchase_order: await getPurchaseOrderDetail(db, id) });
  })
);

// POST /api/purchase-orders/:id/receive - goods receipt (any lab member).
purchaseOrdersRouter.post(
  '/:id/receive',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    await requirePoAccess(req, id);
    const body = parse(receiptSchema, req.body);
    const receipt = await receiveGoods(id, req.user!.id, {
      delivery_reference: body.delivery_reference,
      received_at: body.received_at || null,
      note: body.note,
      lines: body.lines.map((line) => ({ ...line, reject_reason: line.reject_reason ?? null })),
    });
    res.status(201).json({ receipt, purchase_order: await getPurchaseOrderDetail(db, id) });
  })
);

// POST /api/purchase-orders/:id/invoice - multipart field "file". Reads the invoice with AI or falls back to manual entry.
purchaseOrdersRouter.post(
  '/:id/invoice',
  requireAuth,
  upload.single('file'),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    await requirePoAccess(req, id);
    if (!req.file) fail(400, 'VALIDATION_ERROR', 'file: Attach a JPG, PNG or PDF invoice.');
    const result = await uploadInvoice(id, req.user!.id, {
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      filename: req.file.originalname,
    });
    res.status(201).json({ ...result, purchase_order: await getPurchaseOrderDetail(db, id) });
  })
);

// GET /api/purchase-orders/:id/supplier-link (for the Copy button)
purchaseOrdersRouter.get(
  '/:id/supplier-link',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    await requirePoAccess(req, id);
    const row = await db.query<{ supplier_token: string }>('SELECT supplier_token FROM purchase_orders WHERE id = $1', [id]);
    res.json({ url: supplierLink(row.rows[0].supplier_token) });
  })
);

// Receipts: detail page and GRN.
receiptsRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const row = await db.query<{ lab_id: number }>('SELECT lab_id FROM goods_receipts WHERE id = $1', [id]);
    if (row.rows.length === 0) fail(404, 'NOT_FOUND', 'Goods receipt not found.');
    await assertLabAccess(req.user!, Number(row.rows[0].lab_id));
    res.json({ receipt: await getReceipt(db, id) });
  })
);

// Invoices: edit extracted lines (pending only), accept (admin) and dispute (any lab member).
invoicesRouter.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const invoice = await loadInvoice(db, id);
    await assertLabAccess(req.user!, invoice.lab_id);
    const body = parse(invoiceEditSchema, req.body);
    const header: InvoiceHeader = {
      invoice_number: body.invoice_number,
      invoice_date: body.invoice_date ?? null,
      tax: body.tax,
      total: body.total ?? null,
      items: body.items.map((item) => ({
        po_item_id: item.po_item_id ?? null,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: item.line_total ?? item.quantity * item.unit_price,
      })),
    };
    const updated = await withTransaction((tx) => updateInvoiceLines(tx, id, header, req.user!.id));
    res.json({ invoice: updated });
  })
);

invoicesRouter.post(
  '/:id/accept',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    requireAdminFor(req);
    const id = Number(req.params.id);
    const invoice = await loadInvoice(db, id);
    await assertLabAccess(req.user!, invoice.lab_id);
    const updated = await withTransaction((tx) => reviewInvoice(tx, id, 'accept', req.user!.id, ''));
    res.json({ invoice: updated });
  })
);

invoicesRouter.post(
  '/:id/dispute',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const invoice = await loadInvoice(db, id);
    await assertLabAccess(req.user!, invoice.lab_id);
    const body = parse(reasonSchema, req.body);
    const updated = await withTransaction((tx) => reviewInvoice(tx, id, 'dispute', req.user!.id, body.reason));
    res.json({ invoice: updated });
  })
);

invoicesRouter.get(
  '/:id/file',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const invoice = await loadInvoice(db, id);
    await assertLabAccess(req.user!, invoice.lab_id);
    const file = await db.query<{ file_data: Buffer | null; mime_type: string; original_filename: string }>(
      'SELECT file_data, mime_type, original_filename FROM supplier_invoices WHERE id = $1',
      [id]
    );
    const row = file.rows[0];
    if (!row.file_data) fail(404, 'NOT_FOUND', 'No file is attached to this invoice.');
    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${row.original_filename.replace(/"/g, '')}"`);
    res.send(Buffer.from(row.file_data));
  })
);
