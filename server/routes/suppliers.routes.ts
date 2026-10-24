import { Router } from 'express';
import { z } from 'zod';
import { db, withTransaction } from '../db.ts';
import { fail } from '../errors.ts';
import { asyncHandler, validateBody } from '../middleware/validate.ts';
import { requireAuth, requireAdmin, type AuthRequest } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';

export const suppliersRouter = Router();

const supplierSchema = z.object({
  name: z.string().trim().min(2, 'Supplier name is required'),
  contact_person: z.string().trim().optional().default(''),
  email: z.string().trim().email('Invalid email address').or(z.literal('')).optional().default(''),
  phone: z.string().trim().optional().default(''),
  address: z.string().trim().optional().default(''),
});

const SUPPLIER_SELECT = `
  SELECT s.id, s.name, s.contact_person, s.email, s.phone, s.address, s.created_at,
    (SELECT COUNT(*)::int FROM products p WHERE p.supplier_id = s.id AND p.is_active = true) AS product_count,
    (SELECT COUNT(*)::int FROM purchase_orders po WHERE po.supplier_id = s.id
       AND po.status IN ('draft', 'pending_approval', 'approved', 'sent', 'partially_received')) AS open_po_count
  FROM suppliers s`;

suppliersRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await db.query(`${SUPPLIER_SELECT} ORDER BY s.name ASC`);
    const supplied = await db.query(
      `SELECT supplier_id, sku, name FROM products WHERE supplier_id IS NOT NULL AND is_active = true ORDER BY name`
    );
    const bySupplier = new Map<number, { sku: string; name: string }[]>();
    for (const row of supplied.rows) {
      const list = bySupplier.get(Number(row.supplier_id)) ?? [];
      list.push({ sku: row.sku, name: row.name });
      bySupplier.set(Number(row.supplier_id), list);
    }
    res.json({
      suppliers: result.rows.map((row) => ({
        ...row,
        id: Number(row.id),
        email: row.email || null,
        products: bySupplier.get(Number(row.id)) ?? [],
      })),
    });
  })
);

// Suppliers are a shared vendor list, so only the admin changes them.
suppliersRouter.post(
  '/',
  requireAuth,
  requireAdmin,
  validateBody(supplierSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    const b = req.body as z.infer<typeof supplierSchema>;
    const supplier = await withTransaction(async (tx) => {
      const inserted = await tx.query(
        'INSERT INTO suppliers (name, contact_person, email, phone, address) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [b.name, b.contact_person, b.email || null, b.phone, b.address]
      );
      const id = Number(inserted.rows[0].id);
      await writeAudit(tx, { actorId: req.user!.id, action: 'supplier.create', entityType: 'supplier', entityId: id, newValue: { name: b.name } });
      return id;
    });
    const row = await db.query(`${SUPPLIER_SELECT} WHERE s.id = $1`, [supplier]);
    res.status(201).json({ supplier: { ...row.rows[0], id: Number(row.rows[0].id) } });
  })
);

suppliersRouter.put(
  '/:id',
  requireAuth,
  requireAdmin,
  validateBody(supplierSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const b = req.body as z.infer<typeof supplierSchema>;
    await withTransaction(async (tx) => {
      const before = await tx.query('SELECT name, email, phone, address, contact_person FROM suppliers WHERE id = $1 FOR UPDATE', [id]);
      if (before.rows.length === 0) fail(404, 'NOT_FOUND', 'Supplier not found.');
      await tx.query(
        'UPDATE suppliers SET name = $1, contact_person = $2, email = $3, phone = $4, address = $5 WHERE id = $6',
        [b.name, b.contact_person, b.email || null, b.phone, b.address, id]
      );
      await writeAudit(tx, { actorId: req.user!.id, action: 'supplier.update', entityType: 'supplier', entityId: id, oldValue: before.rows[0], newValue: b });
    });
    const row = await db.query(`${SUPPLIER_SELECT} WHERE s.id = $1`, [id]);
    res.json({ supplier: { ...row.rows[0], id: Number(row.rows[0].id) } });
  })
);
