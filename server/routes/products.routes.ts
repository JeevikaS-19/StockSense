import { Router } from 'express';
import { z } from 'zod';
import { db, withTransaction } from '../db.ts';
import { fail, round2, toNumber } from '../errors.ts';
import { asyncHandler, validateBody, parse, nullableInt } from '../middleware/validate.ts';
import { requireAuth, requireAdmin, requireLabAccess, assertLabAccess, type AuthRequest } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';
import { ON_ORDER_SQL, updateReorderFields } from '../services/reorder.ts';

export const productsRouter = Router();

const reorderFields = {
  reorder_level: z.coerce.number().min(0, 'Reorder point cannot be negative.'),
  reorder_qty: nullableInt(1),
  lead_time_days: z.coerce.number().int().min(0, 'Lead time cannot be negative.').max(365, 'Lead time is too long.'),
};

const productFields = {
  name: z.string().trim().min(2, 'Product name is required'),
  description: z.string().optional().default(''),
  category: z.string().trim().min(1, 'Category is required'),
  supplier_id: nullableInt(1),
  unit: z.string().trim().min(1, 'Unit of measurement is required').default('units'),
  unit_price: z.coerce.number().min(0, 'Unit cost cannot be negative.').default(0),
};

const createProductSchema = z.object({
  lab_id: z.coerce.number().int().positive('Laboratory is required'),
  sku: z.string().trim().min(1, 'SKU is required'),
  ...productFields,
  reorder_level: z.coerce.number().min(0, 'Reorder point cannot be negative.').default(5),
  reorder_qty: reorderFields.reorder_qty,
  lead_time_days: z.coerce.number().int().min(0).max(365).default(7),
});

// lab_id is part of the body so the handler and requireLabAccess read the same, already-validated value.
const updateProductSchema = z.object({
  lab_id: z.coerce.number().int().positive('Laboratory is required'),
  ...productFields,
  reorder_level: reorderFields.reorder_level,
  reorder_qty: reorderFields.reorder_qty,
  lead_time_days: reorderFields.lead_time_days,
});

const PRODUCT_SELECT = `
  SELECT p.id, p.lab_id, p.sku, p.name, p.description, p.category, p.supplier_id, s.name AS supplier_name,
    p.unit, p.quantity, p.reorder_level, p.reorder_qty, p.lead_time_days, p.unit_price, p.is_active,
    p.created_at, p.updated_at, ${ON_ORDER_SQL} AS on_order
  FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id`;

function formatProduct(row: any) {
  const quantity = toNumber(row.quantity);
  const reorderLevel = toNumber(row.reorder_level);
  const onOrder = round2(toNumber(row.on_order));
  return {
    ...row,
    id: Number(row.id),
    lab_id: Number(row.lab_id),
    supplier_id: row.supplier_id === null ? null : Number(row.supplier_id),
    quantity,
    reorder_level: reorderLevel,
    reorder_qty: row.reorder_qty === null ? null : Number(row.reorder_qty),
    lead_time_days: Number(row.lead_time_days),
    unit_price: toNumber(row.unit_price),
    on_order: onOrder,
    effective_stock: round2(quantity + onOrder),
    status: quantity === 0 ? 'out' : quantity <= reorderLevel ? 'low' : 'ok',
  };
}

// GET /api/products/categories?lab_id=
productsRouter.get(
  '/categories',
  requireAuth,
  requireLabAccess,
  asyncHandler(async (req, res) => {
    const labId = Number(req.query.lab_id);
    const result = await db.query(
      'SELECT DISTINCT category FROM products WHERE lab_id = $1 AND is_active = true ORDER BY category ASC',
      [labId]
    );
    res.json({ categories: result.rows.map((r) => r.category) });
  })
);

// GET /api/products?lab_id=&search=&category=&low_stock=&sort_by=&order=&page=&limit=
productsRouter.get(
  '/',
  requireAuth,
  requireLabAccess,
  asyncHandler(async (req, res) => {
    const labId = Number(req.query.lab_id);
    const search = String(req.query.search ?? '').trim();
    const category = String(req.query.category ?? '').trim();
    const lowStockOnly = req.query.low_stock === 'true';
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '10'), 10) || 10));
    const offset = (page - 1) * limit;

    const sortColumns: Record<string, string> = {
      name: 'p.name',
      sku: 'p.sku',
      category: 'p.category',
      quantity: 'p.quantity',
      reorder_level: 'p.reorder_level',
      unit_price: 'p.unit_price',
      created_at: 'p.created_at',
    };
    const sortColumn = sortColumns[String(req.query.sort_by ?? 'name')] ?? 'p.name';
    const order = String(req.query.order ?? '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const where: string[] = ['p.lab_id = $1', 'p.is_active = true'];
    const params: unknown[] = [labId];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(p.sku ILIKE $${params.length} OR p.name ILIKE $${params.length})`);
    }
    if (category) {
      params.push(category);
      where.push(`p.category = $${params.length}`);
    }
    if (lowStockOnly) where.push('p.quantity <= p.reorder_level');
    const whereSql = where.join(' AND ');

    const total = await db.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM products p WHERE ${whereSql}`, params);
    const items = await db.query(
      `${PRODUCT_SELECT} WHERE ${whereSql} ORDER BY ${sortColumn} ${order}, p.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const count = total.rows[0].total;
    res.json({
      products: items.rows.map(formatProduct),
      pagination: { total: count, page, limit, total_pages: Math.ceil(count / limit) || 1 },
    });
  })
);

// POST /api/products
productsRouter.post(
  '/',
  requireAuth,
  requireLabAccess,
  validateBody(createProductSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    const body = req.body as z.infer<typeof createProductSchema>;
    const sku = body.sku.toUpperCase();
    const product = await withTransaction(async (tx) => {
      const existing = await tx.query('SELECT is_active FROM products WHERE lab_id = $1 AND sku = $2', [body.lab_id, sku]);
      if (existing.rows.length > 0) {
        fail(
          409,
          'SKU_EXISTS',
          existing.rows[0].is_active
            ? `SKU "${sku}" is already assigned to a product in this laboratory.`
            : `SKU "${sku}" was used by an archived product in this laboratory. Choose a different SKU.`
        );
      }
      const inserted = await tx.query(
        `INSERT INTO products (lab_id, sku, name, description, category, supplier_id, unit, quantity, reorder_level, reorder_qty, unit_price, lead_time_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11) RETURNING id`,
        [body.lab_id, sku, body.name, body.description.trim(), body.category, body.supplier_id ?? null, body.unit, body.reorder_level, body.reorder_qty ?? null, body.unit_price, body.lead_time_days]
      );
      const id = Number(inserted.rows[0].id);
      await writeAudit(tx, { actorId: req.user!.id, action: 'product.create', entityType: 'product', entityId: id, labId: body.lab_id, newValue: { sku, name: body.name, category: body.category } });
      const row = await tx.query(`${PRODUCT_SELECT} WHERE p.id = $1`, [id]);
      return formatProduct(row.rows[0]);
    });
    res.status(201).json({ product });
  })
);

// PUT /api/products/:id (lab_id in the body)
productsRouter.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = parse(updateProductSchema, req.body);
    await assertLabAccess(req.user!, body.lab_id);
    const productId = Number(req.params.id);

    const product = await withTransaction(async (tx) => {
      const current = await tx.query(`${PRODUCT_SELECT} WHERE p.id = $1 AND p.lab_id = $2 AND p.is_active = true FOR UPDATE OF p`, [productId, body.lab_id]);
      if (current.rows.length === 0) fail(404, 'NOT_FOUND', 'Product not found in this laboratory.');
      const before = formatProduct(current.rows[0]);

      await tx.query(
        `UPDATE products SET name = $1, description = $2, category = $3, supplier_id = $4, unit = $5, unit_price = $6, updated_at = NOW()
         WHERE id = $7 AND lab_id = $8`,
        [body.name, body.description.trim(), body.category, body.supplier_id ?? null, body.unit, body.unit_price, productId, body.lab_id]
      );
      await updateReorderFields(tx, productId, body.lab_id, {
        reorder_level: body.reorder_level,
        reorder_qty: body.reorder_qty ?? null,
        lead_time_days: body.lead_time_days,
      }, req.user!.id);

      const changes: Record<string, unknown> = {};
      const previous: Record<string, unknown> = {};
      const next: Record<string, unknown> = {
        name: body.name,
        category: body.category,
        supplier_id: body.supplier_id ?? null,
        unit: body.unit,
        unit_price: body.unit_price,
        description: body.description.trim(),
      };
      for (const key of Object.keys(next)) {
        if (String((before as any)[key] ?? '') !== String(next[key] ?? '')) {
          previous[key] = (before as any)[key] ?? null;
          changes[key] = next[key];
        }
      }
      if (Object.keys(changes).length > 0) {
        await writeAudit(tx, { actorId: req.user!.id, action: 'product.update', entityType: 'product', entityId: productId, labId: body.lab_id, oldValue: previous, newValue: changes });
      }

      const fresh = await tx.query(`${PRODUCT_SELECT} WHERE p.id = $1`, [productId]);
      return formatProduct(fresh.rows[0]);
    });
    res.json({ product });
  })
);

// DELETE /api/products/:id?lab_id= (admin, soft delete)
productsRouter.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const productId = Number(req.params.id);
    const labId = Number(req.query.lab_id);
    if (!labId) fail(400, 'INVALID_LAB_ID', 'Laboratory ID parameter is required.');

    const name = await withTransaction(async (tx) => {
      const updated = await tx.query(
        'UPDATE products SET is_active = false, updated_at = NOW() WHERE id = $1 AND lab_id = $2 AND is_active = true RETURNING name, sku',
        [productId, labId]
      );
      if (updated.rows.length === 0) fail(404, 'NOT_FOUND', 'Product not found or already archived.');
      await writeAudit(tx, { actorId: req.user!.id, action: 'product.archive', entityType: 'product', entityId: productId, labId, oldValue: { is_active: true }, newValue: { is_active: false } });
      return updated.rows[0].name as string;
    });
    res.json({ success: true, message: `Product ${name} has been archived.` });
  })
);
