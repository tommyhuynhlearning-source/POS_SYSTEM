import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
const app = express();
app.use(cors());
app.use(express.json({ limit: "32kb" }));
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || "localhost",
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || "pos",
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE,
      },
);
const secret = process.env.JWT_SECRET!;
const catalog = process.env.CATALOG_URL || "http://localhost:3001";
async function init() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id uuid NOT NULL,customer_name text NOT NULL,customer_phone text NOT NULL,customer_address text NOT NULL,customer_email text NOT NULL DEFAULT '',sms_consent boolean NOT NULL DEFAULT false,email_consent boolean NOT NULL DEFAULT false,total_minor integer NOT NULL,status text NOT NULL DEFAULT 'PENDING_PAYMENT',payment_method text,source text NOT NULL DEFAULT 'POS',created_at timestamptz NOT NULL DEFAULT now());CREATE TABLE IF NOT EXISTS order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,dish_id uuid NOT NULL,dish_name text NOT NULL,unit_price_minor integer NOT NULL,quantity integer NOT NULL CHECK(quantity>0));CREATE TABLE IF NOT EXISTS receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,restaurant_id uuid NOT NULL,receipt_number text UNIQUE NOT NULL,amount_minor integer NOT NULL,status text NOT NULL DEFAULT 'PENDING_PAYMENT',payment_method text,created_at timestamptz NOT NULL DEFAULT now());`,
  );
  await pool.query(
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email text NOT NULL DEFAULT ''; ALTER TABLE orders ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'POS'; UPDATE orders SET source='ONLINE' WHERE source='POS' AND payment_method IS NULL AND customer_phone<>'' AND customer_address<>''; ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method text; ALTER TABLE receipts ADD COLUMN IF NOT EXISTS payment_method text; ALTER TABLE orders ADD COLUMN IF NOT EXISTS sms_consent boolean NOT NULL DEFAULT false; ALTER TABLE orders ADD COLUMN IF NOT EXISTS email_consent boolean NOT NULL DEFAULT false; CREATE TABLE IF NOT EXISTS promotions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id uuid NOT NULL,channel text NOT NULL CHECK(channel IN ('SMS','EMAIL')),title text NOT NULL,message text NOT NULL,status text NOT NULL,recipient_count integer NOT NULL DEFAULT 0,failed_count integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now())`,
  );
  await pool.query(
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_number integer; CREATE TABLE IF NOT EXISTS table_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id uuid NOT NULL,table_number integer NOT NULL,opened_at timestamptz NOT NULL DEFAULT now(),closed_at timestamptz); CREATE UNIQUE INDEX IF NOT EXISTS one_open_session_per_table ON table_sessions(restaurant_id,table_number) WHERE closed_at IS NULL; CREATE TABLE IF NOT EXISTS reservations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id uuid NOT NULL,table_number integer NOT NULL,customer_name text NOT NULL,customer_phone text NOT NULL,party_size integer NOT NULL,start_at timestamptz NOT NULL,end_at timestamptz NOT NULL,status text NOT NULL DEFAULT 'CONFIRMED',created_at timestamptz NOT NULL DEFAULT now()); CREATE INDEX IF NOT EXISTS reservations_by_time ON reservations(restaurant_id,start_at,end_at) WHERE status IN ('CONFIRMED','SEATED')`,
  );
}
function auth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (!token) throw Error();
    (req as any).user = jwt.verify(token, secret);
    next();
  } catch {
    res.status(401).json({ error: "Please sign in" });
  }
}
app.get("/health", (_q, r) => r.json({ ok: true }));
async function publicRestaurant(slug: string) {
  const response = await fetch(
    `${catalog}/api/catalog/public/${encodeURIComponent(slug)}`,
  );
  if (!response.ok) return null;
  return response.json() as Promise<any>;
}
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
function scheduledSlots(openingTime: string, closingTime: string) {
  const open = Number(openingTime.slice(0, 2));
  const close = Number(closingTime.slice(0, 2));
  return Array.from(
    { length: Math.max(0, close - open) },
    (_, i) => `${String(open + i).padStart(2, "0")}:00`,
  );
}
async function occupiedTables(
  restaurantId: string,
  date: string,
  time: string,
) {
  const timezone = process.env.APP_TIMEZONE || "UTC";
  const q = await pool.query(
    `WITH slot AS (SELECT ($2::date + $3::time) AT TIME ZONE $4 AS starts, (($2::date + $3::time) AT TIME ZONE $4) + interval '1 hour' AS ends) SELECT table_number FROM reservations,slot WHERE restaurant_id=$1 AND status IN ('CONFIRMED','SEATED') AND start_at < slot.ends AND end_at > slot.starts UNION SELECT table_number FROM table_sessions,slot WHERE restaurant_id=$1 AND opened_at < slot.ends AND COALESCE(closed_at,GREATEST(opened_at + interval '1 hour',now())) > slot.starts`,
    [restaurantId, date, time, timezone],
  );
  return new Set<number>(q.rows.map((row) => Number(row.table_number)));
}
app.get("/api/orders/public/:slug/availability", async (req, res) => {
  if (!validDate(req.query.date))
    return res.status(400).json({ error: "Choose a valid date" });
  const restaurant: any = await publicRestaurant(req.params.slug);
  if (!restaurant)
    return res
      .status(404)
      .json({ error: "Restaurant is unavailable for online reservations" });
  const slots = [];
  for (const time of scheduledSlots(
    restaurant.openingTime,
    restaurant.closingTime,
  )) {
    const occupied = await occupiedTables(restaurant.id, req.query.date, time);
    const start = await pool.query(
      `SELECT ($1::date + $2::time) AT TIME ZONE $3 AS start`,
      [req.query.date, time, process.env.APP_TIMEZONE || "UTC"],
    );
    const past = new Date(start.rows[0].start).getTime() <= Date.now();
    const used = [...occupied].filter(
      (tableNumber) => tableNumber <= restaurant.tableCount,
    ).length;
    slots.push({
      time,
      availableCount: past ? 0 : Math.max(0, restaurant.tableCount - used),
    });
  }
  res.json({ tableCount: restaurant.tableCount, slots });
});
app.post("/api/orders/public/:slug/reservations", async (req, res) => {
  const restaurant: any = await publicRestaurant(req.params.slug);
  if (!restaurant)
    return res
      .status(404)
      .json({ error: "Restaurant is unavailable for online reservations" });
  const { name, phone, date, time } = req.body;
  const partySize = Number(req.body.partySize);
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 120 ||
    typeof phone !== "string" ||
    !phone.trim() ||
    phone.trim().length > 40 ||
    !validDate(date) ||
    !scheduledSlots(restaurant.openingTime, restaurant.closingTime).includes(
      time,
    ) ||
    !Number.isInteger(partySize) ||
    partySize < 1 ||
    partySize > 20
  )
    return res.status(400).json({
      error: "Enter your name, phone, guest count, and an available time",
    });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1),hashtext('table-capacity'))",
      [restaurant.id],
    );
    const blocked = await occupiedTables(restaurant.id, date, time);
    const tableNumber = Array.from(
      { length: restaurant.tableCount },
      (_, i) => i + 1,
    ).find((n) => !blocked.has(n));
    if (!tableNumber) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "That time just filled up. Choose another available time.",
      });
    }
    const slot = await client.query(
      `SELECT ($1::date + $2::time) AT TIME ZONE $3 AS starts`,
      [date, time, process.env.APP_TIMEZONE || "UTC"],
    );
    if (new Date(slot.rows[0].starts).getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Choose a future time" });
    }
    const booking = await client.query(
      `INSERT INTO reservations(restaurant_id,table_number,customer_name,customer_phone,party_size,start_at,end_at) VALUES($1,$2,$3,$4,$5,$6::timestamptz,$6::timestamptz + interval '1 hour') RETURNING id,table_number AS "tableNumber",customer_name AS "customerName",customer_phone AS "customerPhone",party_size AS "partySize",start_at AS "startAt",end_at AS "endAt",status`,
      [
        restaurant.id,
        tableNumber,
        name.trim(),
        phone.trim(),
        partySize,
        slot.rows[0].starts,
      ],
    );
    await client.query("COMMIT");
    res.status(201).json({
      ...booking.rows[0],
      restaurantName: restaurant.name,
      message: "Your table is confirmed",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Could not complete the reservation" });
  } finally {
    client.release();
  }
});
app.get("/api/orders/:restaurantId/reservations", auth, async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "OWNER" || user.restaurantId !== req.params.restaurantId)
    return res.status(403).json({ error: "Not allowed" });
  const q = await pool.query(
    `SELECT id,table_number AS "tableNumber",customer_name AS "customerName",customer_phone AS "customerPhone",party_size AS "partySize",start_at AS "startAt",end_at AS "endAt",status FROM reservations WHERE restaurant_id=$1 AND start_at >= now() - interval '1 day' AND status IN ('CONFIRMED','SEATED') ORDER BY start_at LIMIT 100`,
    [req.params.restaurantId],
  );
  res.json(q.rows);
});
app.get("/api/orders/:restaurantId/tables", auth, async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "OWNER" || user.restaurantId !== req.params.restaurantId)
    return res.status(403).json({ error: "Not allowed" });
  const [sessions, reservations] = await Promise.all([
    pool.query(
      `SELECT table_number AS "tableNumber",opened_at AS "openedAt" FROM table_sessions WHERE restaurant_id=$1 AND closed_at IS NULL`,
      [req.params.restaurantId],
    ),
    pool.query(
      `SELECT table_number AS "tableNumber",customer_name AS "customerName",party_size AS "partySize",start_at AS "startAt" FROM reservations WHERE restaurant_id=$1 AND status='CONFIRMED' AND start_at < now() + interval '1 hour' AND end_at > now()`,
      [req.params.restaurantId],
    ),
  ]);
  res.json({ occupied: sessions.rows, reserved: reservations.rows });
});
app.post(
  "/api/orders/:restaurantId/tables/:tableNumber/open",
  auth,
  async (req, res) => {
    const user = (req as any).user;
    if (user.role !== "OWNER" || user.restaurantId !== req.params.restaurantId)
      return res.status(403).json({ error: "Not allowed" });
    const tableNumber = Number(req.params.tableNumber);
    const restaurantResponse = await fetch(`${catalog}/api/catalog/me`, {
      headers: { Authorization: req.headers.authorization || "" },
    });
    if (!restaurantResponse.ok)
      return res.status(401).json({ error: "Please sign in again" });
    const settings: any = await restaurantResponse.json();
    if (
      !Number.isInteger(tableNumber) ||
      tableNumber < 1 ||
      tableNumber > settings.restaurant.tableCount
    )
      return res.status(400).json({ error: "Invalid table" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1),hashtext('table-capacity'))",
        [req.params.restaurantId],
      );
      const active = await client.query(
        `SELECT id FROM table_sessions WHERE restaurant_id=$1 AND table_number=$2 AND closed_at IS NULL FOR UPDATE`,
        [req.params.restaurantId, tableNumber],
      );
      if (active.rowCount) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({ error: "This table is already occupied" });
      }
      const reservation = await client.query(
        `SELECT id FROM reservations WHERE restaurant_id=$1 AND table_number=$2 AND status='CONFIRMED' AND start_at <= now() AND end_at > now() FOR UPDATE`,
        [req.params.restaurantId, tableNumber],
      );
      const upcoming = await client.query(
        `SELECT id FROM reservations WHERE restaurant_id=$1 AND table_number=$2 AND status='CONFIRMED' AND start_at > now() AND start_at < now() + interval '1 hour' FOR UPDATE`,
        [req.params.restaurantId, tableNumber],
      );
      if (upcoming.rowCount) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({ error: "This table is reserved within the next hour" });
      }
      if (reservation.rowCount)
        await client.query(
          `UPDATE reservations SET status='SEATED' WHERE id=$1`,
          [reservation.rows[0].id],
        );
      const session = await client.query(
        `INSERT INTO table_sessions(restaurant_id,table_number) VALUES($1,$2) RETURNING id,table_number AS "tableNumber",opened_at AS "openedAt"`,
        [req.params.restaurantId, tableNumber],
      );
      await client.query("COMMIT");
      res.status(201).json(session.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "Could not open table" });
    } finally {
      client.release();
    }
  },
);
app.post("/api/orders", async (req, res) => {
  try {
    const { slug, items, customer, paymentMethod } = req.body;
    const method = String(paymentMethod || "").toUpperCase();
    if (
      !slug ||
      !Array.isArray(items) ||
      !items.length ||
      items.length > 50 ||
      !customer?.name ||
      !customer?.phone ||
      !customer?.address
    )
      return res.status(400).json({
        error: "Restaurant, items, name, phone and address are required",
      });
    if (!["COD", "CARD", "QR"].includes(method))
      return res.status(400).json({ error: "Choose COD, card or QR payment" });
    if (method !== "COD")
      return res
        .status(503)
        .json({ error: `${method} payment is not configured yet` });
    const rr = await fetch(
      `${catalog}/api/catalog/public/${encodeURIComponent(slug)}`,
    );
    if (!rr.ok)
      return res.status(400).json({ error: "Restaurant menu is unavailable" });
    const restaurant: any = await rr.json();
    const normalized = items.map((x: any) => ({
      id: String(x.id),
      quantity: Number(x.quantity),
    }));
    if (
      normalized.some(
        (x) =>
          !Number.isInteger(x.quantity) || x.quantity < 1 || x.quantity > 99,
      )
    )
      return res.status(400).json({ error: "Invalid item quantity" });
    const dishes = new Map<string, any>(
      restaurant.dishes.map((x: any) => [x.id, x] as [string, any]),
    );
    if (normalized.some((x) => !dishes.has(x.id)))
      return res
        .status(400)
        .json({ error: "Menu changed. Refresh and try again." });
    const lines = normalized.map((x) => {
      const d: any = dishes.get(x.id);
      return { ...x, name: d.name, price: d.priceMinor };
    });
    const total = lines.reduce((n, x) => n + x.price * x.quantity, 0);
    if (!Number.isSafeInteger(total))
      return res.status(400).json({ error: "Order total is invalid" });
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const o = await c.query(
        `INSERT INTO orders(restaurant_id,customer_name,customer_phone,customer_address,customer_email,sms_consent,email_consent,total_minor,source,payment_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ONLINE',$9) RETURNING id,status,total_minor AS "totalMinor",payment_method AS "paymentMethod",created_at`,
        [
          restaurant.id,
          String(customer.name).slice(0, 120),
          String(customer.phone).slice(0, 40),
          String(customer.address).slice(0, 500),
          String(customer.email || "").slice(0, 254),
          customer.smsConsent === true,
          customer.emailConsent === true,
          total,
          method,
        ],
      );
      await c.query(
        `INSERT INTO receipts(order_id,restaurant_id,receipt_number,amount_minor,status,payment_method) VALUES($1,$2,$3,$4,'PENDING_PAYMENT',$5)`,
        [o.rows[0].id, restaurant.id, `R-${o.rows[0].id}`, total, method],
      );
      for (const x of lines)
        await c.query(
          `INSERT INTO order_items(order_id,dish_id,dish_name,unit_price_minor,quantity) VALUES($1,$2,$3,$4,$5)`,
          [o.rows[0].id, x.id, x.name, x.price, x.quantity],
        );
      await c.query("COMMIT");
      res.status(201).json({
        ...o.rows[0],
        message: "COD order created; payment is due on delivery",
      });
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create order" });
  }
});
app.post("/api/orders/staff", auth, async (req, res) => {
  try {
    const u = (req as any).user;
    if (u.role !== "OWNER" || !u.restaurantId)
      return res.status(403).json({ error: "Restaurant owner only" });
    if (req.body.paymentMethod !== "CASH")
      return res
        .status(400)
        .json({ error: "Choose cash and confirm it was received" });
    const items = req.body.items;
    if (!Array.isArray(items) || !items.length || items.length > 50)
      return res.status(400).json({ error: "Choose at least one dish" });
    const r = await fetch(
      `${catalog}/api/catalog/restaurants/${u.restaurantId}/dishes`,
      { headers: { Authorization: req.headers.authorization || "" } },
    );
    if (!r.ok)
      return res
        .status(400)
        .json({ error: "Could not verify the current menu" });
    const menu: any[] = await r.json();
    const requested = items.map((x: any) => ({
      id: String(x.id),
      quantity: Number(x.quantity),
    }));
    if (
      requested.some(
        (x) =>
          !Number.isInteger(x.quantity) || x.quantity < 1 || x.quantity > 99,
      )
    )
      return res.status(400).json({ error: "Invalid quantity" });
    const byId = new Map<string, any>(
      menu.filter((x) => x.available).map((x) => [x.id, x] as [string, any]),
    );
    if (requested.some((x) => !byId.has(x.id)))
      return res
        .status(400)
        .json({ error: "A selected dish is no longer available" });
    const lines = requested.map((x) => {
      const d: any = byId.get(x.id);
      return { ...x, name: d.name, price: d.priceMinor };
    });
    const total = lines.reduce((sum, x) => sum + x.quantity * x.price, 0);
    const tableNumber =
      req.body.tableNumber == null ? null : Number(req.body.tableNumber);
    if (
      tableNumber !== null &&
      (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 200)
    )
      return res.status(400).json({ error: "Invalid table" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (tableNumber !== null) {
        const session = await client.query(
          `SELECT id FROM table_sessions WHERE restaurant_id=$1 AND table_number=$2 AND closed_at IS NULL FOR UPDATE`,
          [u.restaurantId, tableNumber],
        );
        if (!session.rowCount) {
          await client.query("ROLLBACK");
          return res
            .status(409)
            .json({ error: "Open the table before checkout" });
        }
      }
      const order = await client.query(
        `INSERT INTO orders(restaurant_id,customer_name,customer_phone,customer_address,total_minor,status,payment_method,table_number) VALUES($1,'In-store sale','','',$2,'PAID','CASH',$3) RETURNING id,status,total_minor AS "totalMinor",table_number AS "tableNumber"`,
        [u.restaurantId, total, tableNumber],
      );
      await client.query(
        `INSERT INTO receipts(order_id,restaurant_id,receipt_number,amount_minor,status,payment_method) VALUES($1,$2,$3,$4,'PAID','CASH')`,
        [order.rows[0].id, u.restaurantId, `R-${order.rows[0].id}`, total],
      );
      for (const x of lines)
        await client.query(
          `INSERT INTO order_items(order_id,dish_id,dish_name,unit_price_minor,quantity) VALUES($1,$2,$3,$4,$5)`,
          [order.rows[0].id, x.id, x.name, x.price, x.quantity],
        );
      if (tableNumber !== null) {
        await client.query(
          `UPDATE table_sessions SET closed_at=now() WHERE restaurant_id=$1 AND table_number=$2 AND closed_at IS NULL`,
          [u.restaurantId, tableNumber],
        );
        await client.query(
          `UPDATE reservations SET status='COMPLETED' WHERE restaurant_id=$1 AND table_number=$2 AND status='SEATED'`,
          [u.restaurantId, tableNumber],
        );
      }
      await client.query("COMMIT");
      res
        .status(201)
        .json({ ...order.rows[0], message: "Cash payment recorded" });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create order" });
  }
});
app.get("/api/orders/:restaurantId", auth, async (req, res) => {
  const u = (req as any).user;
  if (u.role !== "OWNER" || u.restaurantId !== req.params.restaurantId)
    return res.status(403).json({ error: "Not allowed" });
  const q = await pool.query(
    `SELECT o.id,o.customer_name AS "customerName",o.customer_phone AS "customerPhone",o.customer_address AS "customerAddress",o.total_minor AS "totalMinor",o.status,o.source AS channel,o.payment_method AS "paymentMethod",o.created_at AS "createdAt",COALESCE(json_agg(json_build_object('name',i.dish_name,'quantity',i.quantity,'unitPriceCents',i.unit_price_minor)) FILTER(WHERE i.id IS NOT NULL),'[]') AS items FROM orders o LEFT JOIN order_items i ON i.order_id=o.id WHERE o.restaurant_id=$1 GROUP BY o.id ORDER BY o.created_at DESC LIMIT 100`,
    [req.params.restaurantId],
  );
  res.json(q.rows);
});
app.post(
  "/api/orders/:restaurantId/:orderId/collect-cod",
  auth,
  async (req, res) => {
    const u = (req as any).user;
    if (u.role !== "OWNER" || u.restaurantId !== req.params.restaurantId)
      return res.status(403).json({ error: "Not allowed" });
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const o = await c.query(
        `UPDATE orders SET status='PAID' WHERE id=$1 AND restaurant_id=$2 AND source='ONLINE' AND payment_method='COD' AND status='PENDING_PAYMENT' RETURNING id,total_minor AS \"totalMinor\"`,
        [req.params.orderId, req.params.restaurantId],
      );
      if (!o.rowCount) {
        await c.query("ROLLBACK");
        return res
          .status(409)
          .json({ error: "COD order is not awaiting payment" });
      }
      await c.query(
        `UPDATE receipts SET status='PAID',payment_method='COD' WHERE order_id=$1`,
        [req.params.orderId],
      );
      await c.query("COMMIT");
      res.json({ ...o.rows[0], status: "PAID", paymentMethod: "COD" });
    } catch (e) {
      await c.query("ROLLBACK");
      res.status(500).json({ error: "Could not confirm COD payment" });
    } finally {
      c.release();
    }
  },
);
app.get("/api/orders/:restaurantId/receipts", auth, async (req, res) => {
  const u = (req as any).user;
  if (u.role !== "OWNER" || u.restaurantId !== req.params.restaurantId)
    return res.status(403).json({ error: "Not allowed" });
  const q = await pool.query(
    `SELECT receipt_number AS \"receiptNumber\",order_id AS \"orderId\",amount_minor AS \"amountCents\",status,created_at AS \"createdAt\" FROM receipts WHERE restaurant_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [req.params.restaurantId],
  );
  res.json(q.rows);
});
app.get("/api/orders/:restaurantId/revenue", auth, async (req, res) => {
  const u = (req as any).user;
  if (u.role !== "OWNER" || u.restaurantId !== req.params.restaurantId)
    return res.status(403).json({ error: "Not allowed" });
  const q = await pool.query(
    `SELECT COALESCE(SUM(total_minor) FILTER(WHERE created_at >= date_trunc('day',now() AT TIME ZONE $2) AT TIME ZONE $2),0)::int AS "dayMinor",COALESCE(SUM(total_minor) FILTER(WHERE created_at >= date_trunc('month',now() AT TIME ZONE $2) AT TIME ZONE $2),0)::int AS "monthMinor",COALESCE(SUM(total_minor) FILTER(WHERE created_at >= date_trunc('year',now() AT TIME ZONE $2) AT TIME ZONE $2),0)::int AS "yearMinor",COUNT(*) FILTER(WHERE created_at >= date_trunc('day',now() AT TIME ZONE $2) AT TIME ZONE $2)::int AS "dayOrders",COUNT(*) FILTER(WHERE created_at >= date_trunc('month',now() AT TIME ZONE $2) AT TIME ZONE $2)::int AS "monthOrders",COUNT(*) FILTER(WHERE created_at >= date_trunc('year',now() AT TIME ZONE $2) AT TIME ZONE $2)::int AS "yearOrders" FROM orders WHERE restaurant_id=$1 AND status='PAID'`,
    [req.params.restaurantId, process.env.APP_TIMEZONE || "UTC"],
  );
  res.json(q.rows[0]);
});
app.post("/api/orders/:restaurantId/manual-sale", auth, async (req, res) => {
  const u = (req as any).user;
  if (u.role !== "OWNER" || u.restaurantId !== req.params.restaurantId)
    return res.status(403).json({ error: "Not allowed" });
  const amount = Number(req.body.amountMinor);
  const note = String(req.body.note || "Manual sale")
    .trim()
    .slice(0, 120);
  if (!Number.isSafeInteger(amount) || amount <= 0)
    return res.status(400).json({ error: "Enter a positive amount" });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const o = await c.query(
      `INSERT INTO orders(restaurant_id,customer_name,customer_phone,customer_address,total_minor,status,payment_method) VALUES($1,$2,'','',$3,'PAID','CASH') RETURNING id,status,total_minor AS "totalMinor",created_at`,
      [u.restaurantId, note, amount],
    );
    await c.query(
      `INSERT INTO receipts(order_id,restaurant_id,receipt_number,amount_minor,status,payment_method) VALUES($1,$2,$3,$4,'PAID','CASH')`,
      [o.rows[0].id, u.restaurantId, `R-${o.rows[0].id}`, amount],
    );
    await c.query("COMMIT");
    res.status(201).json(o.rows[0]);
  } catch (e) {
    await c.query("ROLLBACK");
    res.status(500).json({ error: "Could not record sale" });
  } finally {
    c.release();
  }
});
app.get("/api/orders/:restaurantId/promotions", auth, async (req, res) => {
  const u = (req as any).user;
  if (u.role !== "OWNER" || u.restaurantId !== req.params.restaurantId)
    return res.status(403).json({ error: "Not allowed" });
  res.json(
    (
      await pool.query(
        'SELECT id,channel,title,message,status,recipient_count AS "recipientCount",failed_count AS "failedCount",created_at AS "createdAt" FROM promotions WHERE restaurant_id=$1 ORDER BY created_at DESC LIMIT 50',
        [req.params.restaurantId],
      )
    ).rows,
  );
});
app.post("/api/orders/:restaurantId/promotions", auth, async (req, res) => {
  const u = (req as any).user;
  if (u.role !== "OWNER" || u.restaurantId !== req.params.restaurantId)
    return res.status(403).json({ error: "Not allowed" });
  const channel = String(req.body.channel || "").toUpperCase(),
    title = String(req.body.title || "")
      .trim()
      .slice(0, 120),
    message = String(req.body.message || "")
      .trim()
      .slice(0, 1000);
  if (!["SMS", "EMAIL"].includes(channel) || !title || !message)
    return res
      .status(400)
      .json({ error: "Choose a channel and enter a title and message" });
  let recipients: string[] = [];
  if (channel === "EMAIL") {
    if (!process.env.SMTP_HOST || !process.env.SMTP_FROM)
      return res.status(503).json({
        error: "Email sending is not configured. Add SMTP settings first.",
      });
    recipients = (
      await pool.query(
        `SELECT DISTINCT customer_email AS contact FROM orders WHERE restaurant_id=$1 AND email_consent=true AND customer_email<>''`,
        [u.restaurantId],
      )
    ).rows.map((r: any) => r.contact);
  } else {
    if (
      !process.env.TWILIO_ACCOUNT_SID ||
      !process.env.TWILIO_AUTH_TOKEN ||
      !process.env.TWILIO_FROM
    )
      return res.status(503).json({
        error: "SMS sending is not configured. Add Twilio settings first.",
      });
    recipients = (
      await pool.query(
        `SELECT DISTINCT customer_phone AS contact FROM orders WHERE restaurant_id=$1 AND sms_consent=true AND customer_phone<>''`,
        [u.restaurantId],
      )
    ).rows.map((r: any) => r.contact);
  }
  if (!recipients.length)
    return res
      .status(409)
      .json({ error: `No customers have opted in to ${channel} promotions` });
  const inserted = await pool.query(
    `INSERT INTO promotions(restaurant_id,channel,title,message,status) VALUES($1,$2,$3,$4,'SENDING') RETURNING id`,
    [u.restaurantId, channel, title, message],
  );
  let send: (to: string) => Promise<unknown>;
  if (channel === "EMAIL") {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });
    send = (to) =>
      transporter.sendMail({
        from: process.env.SMTP_FROM,
        to,
        subject: title,
        text: message,
      });
  } else {
    send = async (to) => {
      const sid = process.env.TWILIO_ACCOUNT_SID!,
        form = new URLSearchParams({
          From: process.env.TWILIO_FROM!,
          To: to,
          Body: message,
        });
      const result = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form,
        },
      );
      if (!result.ok) throw Error("SMS provider rejected message");
    };
  }
  const results = await Promise.allSettled(recipients.map(send));
  const failed = results.filter((x) => x.status === "rejected").length;
  const status =
    failed === recipients.length ? "FAILED" : failed ? "PARTIAL" : "SENT";
  const q = await pool.query(
    `UPDATE promotions SET status=$2,recipient_count=$3,failed_count=$4 WHERE id=$1 RETURNING id,channel,title,status,recipient_count AS "recipientCount",failed_count AS "failedCount"`,
    [inserted.rows[0].id, status, recipients.length - failed, failed],
  );
  res.status(failed === recipients.length ? 502 : 201).json(q.rows[0]);
});
init()
  .then(() =>
    app.listen(Number(process.env.PORT || 3002), "0.0.0.0", () =>
      console.log("orders service listening"),
    ),
  )
  .catch((e) => {
    console.error("orders init failed", e);
    process.exit(1);
  });
