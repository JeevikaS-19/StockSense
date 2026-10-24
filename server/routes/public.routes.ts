import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../middleware/validate.ts';
import { fail } from '../errors.ts';
import { confirmSupplierOrder, getSupplierView, resolvePoIdForToken } from '../services/supplierPortal.ts';
import { uploadInvoice, INVOICE_MAX_BYTES } from '../services/invoiceUpload.ts';

// Public routes: no login. Every route is keyed by the purchase order's secret supplier token and
// exposes only that one order.
export const publicRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: INVOICE_MAX_BYTES, files: 1 } });

publicRouter.get(
  '/po/:token',
  asyncHandler(async (req, res) => {
    res.json({ purchase_order: await getSupplierView(req.params.token) });
  })
);

publicRouter.post(
  '/po/:token/confirm',
  asyncHandler(async (req, res) => {
    res.json({ purchase_order: await confirmSupplierOrder(req.params.token) });
  })
);

publicRouter.post(
  '/po/:token/invoice',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const po = await resolvePoIdForToken(req.params.token);
    if (!po) fail(404, 'NOT_FOUND', 'This purchase order link is not valid.');
    if (!req.file) fail(400, 'VALIDATION_ERROR', 'file: Attach a JPG, PNG or PDF invoice.');
    const result = await uploadInvoice(po.id, null, {
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      filename: req.file.originalname,
    });
    res.status(201).json({ extraction: result.extraction, reason: result.reason, invoice_number: result.invoice.invoice_number });
  })
);
