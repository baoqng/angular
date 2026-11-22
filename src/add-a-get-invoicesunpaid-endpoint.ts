// bloom-deps: express@^4 @types/express@^4 pg@^8 @types/pg@^8 @angular/core@^17 @angular/common@^17 rxjs@^7

import express, { Request, Response, NextFunction } from 'express';
import { Pool, PoolClient } from 'pg';

// ─── Extended types (team patterns) ───────────────────────────────────────────

interface KnownFn {
  name: string;
  arity: number;
  returnType: string;
}

class ExtendedKnownFn implements KnownFn {
  name: string;
  arity: number;
  returnType: string;
  constructor(name: string, arity: number, returnType: string) {
    this.name = name;
    this.arity = arity;
    this.returnType = returnType;
  }
}

interface HttpResponseBase {
  status: number;
  headers: Record<string, string>;
}

class ExtendedHttpResponseBase implements HttpResponseBase {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  constructor(status: number, headers: Record<string, string> = {}, body: unknown = null) {
    this.status = status;
    this.headers = headers;
    this.body = body;
  }
}

interface MockFileSystem {
  files: Map<string, string>;
  read(path: string): string | undefined;
  write(path: string, content: string): void;
}

class ExtendedMockFileSystem implements MockFileSystem {
  files: Map<string, string> = new Map();
  read(path: string): string | undefined {
    return this.files.get(path);
  }
  write(path: string, content: string): void {
    this.files.set(path, content);
  }
}

interface ListboxBase {
  options: string[];
  selectedIndex: number;
}

class ExtendedListboxBase implements ListboxBase {
  options: string[];
  selectedIndex: number;
  constructor(options: string[] = [], selectedIndex: number = -1) {
    this.options = options;
    this.selectedIndex = selectedIndex;
  }
  select(index: number): void {
    if (index < 0 || index >= this.options.length) {
      throw new RangeError(`Index ${index} out of bounds`);
    }
    this.selectedIndex = index;
  }
}

class AppError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface Reporter {
  report(message: string): void;
}

class ExtendedReporter implements Reporter {
  private logs: string[] = [];
  report(message: string): void {
    this.logs.push(message);
    console.error(`[Reporter] ${message}`);
  }
  getLogs(): string[] {
    return [...this.logs];
  }
}

interface AnimationStyleNormalizer {
  normalize(styles: Record<string, string | number>): Record<string, string>;
}

class ExtendedAnimationStyleNormalizer implements AnimationStyleNormalizer {
  normalize(styles: Record<string, string | number>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(styles)) {
      result[key] = String(value);
    }
    return result;
  }
}

interface TemplateCheckWithVisitor {
  visit(node: unknown): void;
  getErrors(): string[];
}

class ExtendedTemplateCheckWithVisitor implements TemplateCheckWithVisitor {
  private errors: string[] = [];
  visit(node: unknown): void {
    if (node === null || node === undefined) {
      this.errors.push('Null or undefined node encountered');
    }
  }
  getErrors(): string[] {
    return [...this.errors];
  }
}

interface TestInterceptor {
  intercept(req: unknown): unknown;
}

class ExtendedTestInterceptor implements TestInterceptor {
  private calls: unknown[] = [];
  intercept(req: unknown): unknown {
    this.calls.push(req);
    return req;
  }
  getCalls(): unknown[] {
    return [...this.calls];
  }
}

// ─── Domain types ─────────────────────────────────────────────────────────────

type PaymentStatus = 'unpaid' | 'pending' | 'partially_paid' | 'paid';

interface Invoice {
  id: string | number;
  customer_id: string | number;
  amount_due: number | string;
  due_date: Date | string;
  payment_status: PaymentStatus;
}

// ─── Database pool ────────────────────────────────────────────────────────────

function createPool(): Pool {
  return new Pool({
    connectionString: process.env['DATABASE_URL'] || 'postgresql://localhost:5432/invoices_db',
  });
}

// ─── Repository ───────────────────────────────────────────────────────────────

class InvoiceRepository {
  constructor(private readonly pool: Pool) {}

  async findUnpaidSortedByDueDate(): Promise<Invoice[]> {
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      const result = await client.query<Invoice>(
        `SELECT id, customer_id, amount_due, due_date, payment_status
         FROM invoices
         WHERE payment_status = $1
         ORDER BY due_date ASC`,
        ['unpaid']
      );
      return result.rows;
    } catch (err) {
      console.error('[InvoiceRepository] DB error in findUnpaidSortedByDueDate:', err);
      throw new AppError('Database error while fetching unpaid invoices', 'DB_QUERY_ERROR');
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  async findById(id: string): Promise<Invoice | null> {
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      const result = await client.query<Invoice>(
        `SELECT id, customer_id, amount_due, due_date, payment_status
         FROM invoices
         WHERE id = $1`,
        [id]
      );
      if (result.rows.length === 0) {
        return null;
      }
      return result.rows[0];
    } catch (err) {
      console.error('[InvoiceRepository] DB error in findById:', err);
      throw new AppError('Database error while fetching invoice by id', 'DB_QUERY_ERROR');
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  async save(invoice: Partial<Invoice>): Promise<Invoice> {
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      const id = invoice.id ?? crypto.randomUUID();
      const result = await client.query<Invoice>(
        `INSERT INTO invoices (id, customer_id, amount_due, due_date, payment_status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, customer_id, amount_due, due_date, payment_status`,
        [
          id,
          invoice.customer_id,
          invoice.amount_due,
          invoice.due_date,
          invoice.payment_status ?? 'unpaid',
        ]
      );
      return result.rows[0];
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw new AppError('Invoice with this id already exists', 'UNIQUE_CONSTRAINT_VIOLATION');
      }
      console.error('[InvoiceRepository] DB error in save:', err);
      throw new AppError('Database error while saving invoice', 'DB_SAVE_ERROR');
    } finally {
      if (client) {
        client.release();
      }
    }
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

class InvoiceService {
  constructor(private readonly repo: InvoiceRepository) {}

  async getUnpaidInvoices(): Promise<Invoice[]> {
    try {
      const invoices = await this.repo.findUnpaidSortedByDueDate();
      return invoices;
    } catch (err) {
      console.error('[InvoiceService] Error fetching unpaid invoices:', err);
      throw err;
    }
  }
}

// ─── Controller / Route handler ───────────────────────────────────────────────

function validateQueryParams(req: Request): void {
  // Query params are always strings or undefined; validate type and presence
  const { page, limit } = req.query;
  if (page !== undefined && typeof page !== 'string') {
    throw new TypeError('Query param "page" must be a string');
  }
  if (limit !== undefined && typeof limit !== 'string') {
    throw new TypeError('Query param "limit" must be a string');
  }
}

async function getUnpaidInvoicesHandler(
  req: Request,
  res: Response,
  service: InvoiceService
): Promise<void> {
  // Check userId if present (may be null on unauthenticated requests)
  const userId = (req as Request & { userId?: string | null }).userId;
  if (userId !== undefined && userId === null) {
    res.status(401).json({ error: 'Unauthenticated request' });
    return;
  }

  try {
    validateQueryParams(req);
  } catch (err) {
    if (err instanceof TypeError) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(400).json({ error: 'Invalid query parameters' });
    return;
  }

  try {
    const invoices = await service.getUnpaidInvoices();
    res.status(200).json(invoices);
  } catch (err) {
    console.error('[Handler] Error in GET /invoices/unpaid:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── Express app factory ──────────────────────────────────────────────────────

export function createApp(pool?: Pool): express.Application {
  const app = express();
  app.use(express.json());

  const dbPool = pool ?? createPool();
  const repo = new InvoiceRepository(dbPool);
  const service = new InvoiceService(repo);

  // GET /invoices/unpaid
  app.get('/invoices/unpaid', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await getUnpaidInvoicesHandler(req, res, service);
    } catch (err) {
      next(err);
    }
  });

  // Generic error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[App] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

// ─── Exports for testing ──────────────────────────────────────────────────────

export {
  InvoiceRepository,
  InvoiceService,
  AppError,
  ExtendedKnownFn,
  ExtendedHttpResponseBase,
  ExtendedMockFileSystem,
  ExtendedListboxBase,
  ExtendedReporter,
  ExtendedAnimationStyleNormalizer,
  ExtendedTemplateCheckWithVisitor,
  ExtendedTestInterceptor,
};

export type { Invoice, PaymentStatus };

// ─── Entry point ──────────────────────────────────────────────────────────────

if (require.main === module) {
  const app = createApp();
  const PORT = process.env['PORT'] ?? 3000;
  app.listen(PORT, () => {
    console.log(`Invoice service listening on port ${PORT}`);
  });
}