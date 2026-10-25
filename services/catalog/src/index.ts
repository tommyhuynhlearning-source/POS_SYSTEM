import express from "express";
import crypto from "node:crypto";
import cors from "cors";
import bcrypt from "bcryptjs";
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
const schema = `CREATE TABLE IF NOT EXISTS restaurants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,slug text UNIQUE,address text NOT NULL,phone text NOT NULL,status text NOT NULL DEFAULT 'PENDING',published boolean NOT NULL DEFAULT false,table_count integer NOT NULL DEFAULT 10,opening_time time NOT NULL DEFAULT '11:00',closing_time time NOT NULL DEFAULT '22:00',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text UNIQUE NOT NULL,password_hash text NOT NULL,role text NOT NULL CHECK(role IN ('OWNER')),restaurant_id uuid REFERENCES restaurants(id));
CREATE TABLE IF NOT EXISTS dishes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,name text NOT NULL,description text NOT NULL DEFAULT '',price_minor integer NOT NULL CHECK(price_minor>=0),available boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());`;
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "restaurant";
async function init() {
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await pool.query(schema);
  await pool.query(
    `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS table_count integer NOT NULL DEFAULT 10; ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS opening_time time NOT NULL DEFAULT '11:00'; ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS closing_time time NOT NULL DEFAULT '22:00'`,
  );
  await pool.query(
    `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check; DELETE FROM users WHERE role='ADMIN'; UPDATE restaurants SET status='APPROVED',slug=COALESCE(slug, lower(regexp_replace(name,'[^a-zA-Z0-9]+','-','g')) || '-' || substr(id::text,1,6)) WHERE status='PENDING'; ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role='OWNER')`,
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
function owner(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const u = (req as any).user;
  if (u?.role !== "OWNER")
    return res.status(403).json({ error: "Not allowed" });
  next();
}
app.get("/health", (_q, r) => r.json({ ok: true }));
app.post("/api/catalog/register", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim(),
      address = String(req.body.address || "").trim(),
      phone = String(req.body.phone || "").trim(),
      email = String(req.body.email || "")
        .trim()
        .toLowerCase(),
      password = String(req.body.password || "");
    if (
      !name ||
      !address ||
      !phone ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      password.length < 12
    )
      return res.status(400).json({
        error:
          "Enter restaurant details, a valid email, and a password of at least 12 characters",
      });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const rr = await client.query(
        `INSERT INTO restaurants(name,slug,address,phone,status) VALUES($1,$2,$3,$4,'APPROVED') RETURNING id`,
        [
          name,
          `${slugify(name)}-${crypto.randomUUID().slice(0, 6)}`,
          address,
          phone,
        ],
      );
      const hash = await bcrypt.hash(password, 12);
      const ur = await client.query(
        `INSERT INTO users(email,password_hash,role,restaurant_id) VALUES($1,$2,'OWNER',$3) RETURNING id`,
        [email, hash, rr.rows[0].id],
      );
      await client.query("COMMIT");
      res.status(201).json({
        message: "Restaurant account created. Sign in to open your dashboard.",
        userId: ur.rows[0].id,
      });
    } catch (e: any) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e: any) {
    res.status(e.code === "23505" ? 409 : 500).json({
      error:
        e.code === "23505" ? "Email already registered" : "Could not register",
    });
  }
});
app.post("/api/catalog/login", async (req, res) => {
  try {
    const email = String(req.body.email || "")
        .trim()
        .toLowerCase(),
      password = String(req.body.password || "");
    const q = await pool.query(
      `SELECT u.id,u.email,u.password_hash,u.role,u.restaurant_id,r.name AS restaurant_name,r.status,r.slug FROM users u LEFT JOIN restaurants r ON r.id=u.restaurant_id WHERE u.email=$1`,
      [email],
    );
    const u = q.rows[0];
    if (!u || !(await bcrypt.compare(password, u.password_hash)))
      return res.status(401).json({ error: "Email or password is incorrect" });
    const token = jwt.sign(
      { sub: u.id, role: u.role, restaurantId: u.restaurant_id },
      secret,
      { expiresIn: "12h" },
    );
    res.json({
      token,
      user: {
        id: u.id,
        email: u.email,
        role: u.role,
        restaurantId: u.restaurant_id,
        restaurantName: u.restaurant_name,
        status: u.status,
        slug: u.slug,
      },
    });
  } catch {
    res.status(500).json({ error: "Could not sign in" });
  }
});
app.get("/api/catalog/me", auth, async (req, res) => {
  const u = (req as any).user;
  const q = await pool.query(
    `SELECT id,name,slug,address,phone,status,published,table_count AS "tableCount",to_char(opening_time,'HH24:MI') AS "openingTime",to_char(closing_time,'HH24:MI') AS "closingTime" FROM restaurants WHERE id=$1`,
    [u.restaurantId],
  );
  if (!q.rowCount || u.role !== "OWNER")
    return res.status(401).json({ error: "Please sign in again" });
  res.json({ user: u, restaurant: q.rows[0] });
});
app.get("/api/catalog/public/:slug", async (req, res) => {
  const q = await pool.query(
    `SELECT r.id,r.name,r.address,r.phone,r.table_count AS "tableCount",to_char(r.opening_time,'HH24:MI') AS "openingTime",to_char(r.closing_time,'HH24:MI') AS "closingTime",d.id AS dish_id,d.name AS dish_name,d.description,d.price_minor FROM restaurants r LEFT JOIN dishes d ON d.restaurant_id=r.id AND d.available=true WHERE r.slug=$1 AND r.status='APPROVED' AND r.published=true ORDER BY d.created_at`,
    [req.params.slug],
  );
  if (!q.rowCount)
    return res
      .status(404)
      .json({ error: "Restaurant not found or menu unpublished" });
  const a = q.rows[0];
  res.json({
    id: a.id,
    name: a.name,
    address: a.address,
    phone: a.phone,
    tableCount: a.tableCount,
    openingTime: a.openingTime,
    closingTime: a.closingTime,
    dishes: q.rows
      .filter((x) => x.dish_id)
      .map((x) => ({
        id: x.dish_id,
        name: x.dish_name,
        description: x.description,
        priceMinor: x.price_minor,
        available: true,
      })),
  });
});
app.get(
  "/api/catalog/restaurants/:id/dishes",
  auth,
  owner,
  async (req, res) => {
    if ((req as any).user.restaurantId !== req.params.id)
      return res.status(403).json({ error: "Not allowed" });
    res.json(
      (
        await pool.query(
          'SELECT id,name,description,price_minor AS "priceMinor",available FROM dishes WHERE restaurant_id=$1 ORDER BY created_at DESC',
          [req.params.id],
        )
      ).rows,
    );
  },
);
app.post(
  "/api/catalog/restaurants/:id/dishes",
  auth,
  owner,
  async (req, res) => {
    if ((req as any).user.restaurantId !== req.params.id)
      return res.status(403).json({ error: "Not allowed" });
    const name = String(req.body.name || "").trim(),
      description = String(req.body.description || "").trim(),
      price = Number(req.body.priceMinor);
    if (!name || !Number.isSafeInteger(price) || price < 0)
      return res.status(400).json({
        error: "Dish name and price in the currency minor unit are required",
      });
    try {
      const q = await pool.query(
        `INSERT INTO dishes(restaurant_id,name,description,price_minor) VALUES($1,$2,$3,$4) RETURNING id,name,description,price_minor AS "priceMinor",available`,
        [req.params.id, name, description, price],
      );
      res.status(201).json(q.rows[0]);
    } catch {
      res.status(500).json({ error: "Could not add dish" });
    }
  },
);
app.patch(
  "/api/catalog/restaurants/:id/settings",
  auth,
  owner,
  async (req, res) => {
    if ((req as any).user.restaurantId !== req.params.id)
      return res.status(403).json({ error: "Not allowed" });
    const tableCount = Number(req.body.tableCount);
    const openingTime = String(req.body.openingTime || "");
    const closingTime = String(req.body.closingTime || "");
    if (!Number.isInteger(tableCount) || tableCount < 1 || tableCount > 200)
      return res
        .status(400)
        .json({ error: "Table count must be between 1 and 200" });
    if (
      !/^([01]\d|2[0-3]):00$/.test(openingTime) ||
      !/^([01]\d|2[0-3]):00$/.test(closingTime) ||
      openingTime >= closingTime
    )
      return res
        .status(400)
        .json({ error: "Choose whole-hour opening and closing times" });
    const q = await pool.query(
      `UPDATE restaurants SET table_count=$2,opening_time=$3::time,closing_time=$4::time WHERE id=$1 RETURNING table_count AS "tableCount",to_char(opening_time,'HH24:MI') AS "openingTime",to_char(closing_time,'HH24:MI') AS "closingTime"`,
      [req.params.id, tableCount, openingTime, closingTime],
    );
    res.json(q.rows[0]);
  },
);
app.patch(
  "/api/catalog/restaurants/:id/dishes/:dishId",
  auth,
  owner,
  async (req, res) => {
    if ((req as any).user.restaurantId !== req.params.id)
      return res.status(403).json({ error: "Not allowed" });
    const { name, description, priceMinor, available } = req.body;
    if (
      name !== undefined &&
      (typeof name !== "string" || !name.trim() || name.trim().length > 120)
    )
      return res
        .status(400)
        .json({ error: "Dish name must be 1–120 characters" });
    if (
      description !== undefined &&
      (typeof description !== "string" || description.length > 500)
    )
      return res.status(400).json({ error: "Description is too long" });
    if (
      priceMinor !== undefined &&
      (!Number.isSafeInteger(priceMinor) || priceMinor < 0)
    )
      return res
        .status(400)
        .json({ error: "Price must be a non-negative number of minor units" });
    if (available !== undefined && typeof available !== "boolean")
      return res
        .status(400)
        .json({ error: "Availability must be true or false" });
    const q = await pool.query(
      `UPDATE dishes SET name=COALESCE($3,name),description=COALESCE($4,description),price_minor=COALESCE($5,price_minor),available=COALESCE($6,available) WHERE restaurant_id=$1 AND id=$2 RETURNING id,name,description,price_minor AS "priceMinor",available`,
      [
        req.params.id,
        req.params.dishId,
        name,
        description,
        priceMinor,
        available,
      ],
    );
    if (!q.rowCount) return res.status(404).json({ error: "Dish not found" });
    res.json(q.rows[0]);
  },
);
app.patch(
  "/api/catalog/restaurants/:id/publish",
  auth,
  owner,
  async (req, res) => {
    if ((req as any).user.restaurantId !== req.params.id)
      return res.status(403).json({ error: "Not allowed" });
    const q = await pool.query(
      `UPDATE restaurants SET published=$2 WHERE id=$1 RETURNING slug,published`,
      [req.params.id, !!req.body.published],
    );
    if (!q.rowCount)
      return res.status(404).json({ error: "Restaurant not found" });
    res.json(q.rows[0]);
  },
);
init()
  .then(() =>
    app.listen(Number(process.env.PORT || 3001), "0.0.0.0", () =>
      console.log("catalog service listening"),
    ),
  )
  .catch((e) => {
    console.error("catalog init failed", e);
    process.exit(1);
  });
