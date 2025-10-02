import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { getDB, initDB } from "./db.js";

dotenv.config();

if (process.argv.includes("--init-db")) {
  initDB();
  console.log("✅ DB initialized");
  process.exit(0);
}

const app = express();
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// ---------- Helpers ----------
const db = getDB();

function centsToUSD(cents) {
  return (cents / 100).toFixed(2);
}

function getConfig() {
  return db.prepare(`SELECT * FROM config WHERE id = 1`).get();
}

function carState(carId) {
  const cfg = getConfig();
  const car = db.prepare(`
    SELECT c.id, c.capacity, u.id AS driver_id, u.name AS driver_name, u.has_pass AS driver_has_pass
    FROM cars c
    JOIN users u ON u.id = c.driver_id
    WHERE c.id = ?
  `).get(carId);

  const passengers = db.prepare(`
    SELECT u.id, u.name, u.has_pass, u.is_driver
    FROM car_passengers cp
    JOIN users u ON u.id = cp.user_id
    WHERE cp.car_id = ?
    ORDER BY u.name
  `).all(carId);

  const totalOccupants = 1 + passengers.length;
  const anyPass = !!(car?.driver_has_pass || passengers.some(p => p.has_pass));
  const priceCents = anyPass ? cfg.price_with_pass_cents : cfg.price_without_pass_cents;

  return {
    car_id: car.id,
    capacity: car.capacity,
    driver: { id: car.driver_id, name: car.driver_name, has_pass: !!car.driver_has_pass },
    passengers,
    seats_left: Math.max(0, car.capacity - totalOccupants),
    any_pass_in_car: anyPass,
    passenger_price_cents: priceCents,
    passenger_price: `$${centsToUSD(priceCents)}`
  };
}

function fullState() {
  const cfg = getConfig();

  const cars = db.prepare(`
    SELECT c.id FROM cars c ORDER BY c.id ASC
  `).all().map(row => carState(row.id));

  const usersUnassigned = db.prepare(`
    SELECT u.id, u.name, u.has_pass, u.is_driver
    FROM users u
    WHERE u.is_driver = 0
      AND u.id NOT IN (SELECT user_id FROM car_passengers)
      AND u.id NOT IN (SELECT driver_id FROM cars)
    ORDER BY u.name
  `).all();

  const totals = (() => {
    let passengerCount = 0;
    let feesCents = 0;
    for (const c of cars) {
      passengerCount += c.passengers.length;
      feesCents += c.passengers.length * c.passenger_price_cents;
    }
    return {
      passenger_count: passengerCount,
      total_fees_cents: feesCents,
      total_fees: `$${centsToUSD(feesCents)}`
    };
  })();

  return { config: cfg, cars, users_unassigned: usersUnassigned, totals };
}

// ---------- Routes ----------

// Health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Config
app.get("/api/config", (req, res) => {
  res.json(getConfig());
});

app.post("/api/config", (req, res) => {
  const { price_with_pass_cents, price_without_pass_cents, max_car_capacity } = req.body;
  if (
    !Number.isInteger(price_with_pass_cents) ||
    !Number.isInteger(price_without_pass_cents) ||
    !Number.isInteger(max_car_capacity)
  ) {
    return res.status(400).json({ error: "Bad config values" });
  }
  db.prepare(`
    UPDATE config
    SET price_with_pass_cents = ?, price_without_pass_cents = ?, max_car_capacity = ?
    WHERE id = 1
  `).run(price_with_pass_cents, price_without_pass_cents, max_car_capacity);
  res.json(getConfig());
});

// Users
app.post("/api/users", (req, res) => {
  const { name, has_pass = false, is_driver = false } = req.body;
  if (!name || typeof name !== "string") return res.status(400).json({ error: "name required" });
  try {
    const info = db.prepare(`
      INSERT INTO users (name, has_pass, is_driver) VALUES (?, ?, ?)
    `).run(name.trim(), has_pass ? 1 : 0, is_driver ? 1 : 0);
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(info.lastInsertRowid);
    res.status(201).json(user);
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      return res.status(409).json({ error: "name already exists" });
    }
    console.error(e);
    res.status(500).json({ error: "internal error" });
  }
});

app.get("/api/users", (req, res) => {
  const users = db.prepare(`SELECT * FROM users ORDER BY created_at DESC`).all();
  res.json(users);
});

app.delete("/api/users/:id", (req, res) => {
  const id = Number(req.params.id);
  const driverCar = db.prepare(`SELECT id FROM cars WHERE driver_id = ?`).get(id);
  if (driverCar) return res.status(400).json({ error: "cannot delete a driver with a car; delete the car first" });
  db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  res.json({ ok: true });
});

// Cars
app.post("/api/cars", (req, res) => {
  const { driver_id, capacity } = req.body;
  if (!Number.isInteger(driver_id) || !Number.isInteger(capacity)) {
    return res.status(400).json({ error: "driver_id and capacity required" });
  }
  const cfg = getConfig();
  if (capacity < 1 || capacity > cfg.max_car_capacity) {
    return res.status(400).json({ error: `capacity must be 1..${cfg.max_car_capacity}` });
  }
  const driver = db.prepare(`SELECT * FROM users WHERE id = ?`).get(driver_id);
  if (!driver) return res.status(404).json({ error: "driver not found" });
  if (!driver.is_driver) return res.status(400).json({ error: "user is not marked as driver" });

  try {
    const info = db.prepare(`INSERT INTO cars (driver_id, capacity) VALUES (?, ?)`).run(driver_id, capacity);
    res.status(201).json(carState(info.lastInsertRowid));
  } catch (e) {
    if (String(e).includes("UNIQUE")) return res.status(409).json({ error: "driver already has a car" });
    console.error(e);
    res.status(500).json({ error: "internal error" });
  }
});

app.get("/api/cars", (_req, res) => {
  const ids = db.prepare(`SELECT id FROM cars ORDER BY id ASC`).all().map(r => r.id);
  res.json(ids.map(carState));
});

app.delete("/api/cars/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`DELETE FROM cars WHERE id = ?`).run(id);
  res.json({ ok: true });
});

// Join / leave car
app.post("/api/cars/:id/join", (req, res) => {
  const carId = Number(req.params.id);
  const { user_id } = req.body;
  if (!Number.isInteger(user_id)) return res.status(400).json({ error: "user_id required" });

  const car = db.prepare(`SELECT * FROM cars WHERE id = ?`).get(carId);
  if (!car) return res.status(404).json({ error: "car not found" });
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user_id);
  if (!user) return res.status(404).json({ error: "user not found" });

  if (user.is_driver) return res.status(400).json({ error: "driver cannot join another car" });
  // already assigned?
  const already = db.prepare(`
    SELECT 1 FROM car_passengers WHERE user_id = ?
  `).get(user_id);
  if (already) return res.status(400).json({ error: "user already assigned to a car" });

  // capacity check (driver counts as 1)
  const cnt = db.prepare(`SELECT COUNT(*) as c FROM car_passengers WHERE car_id = ?`).get(carId).c;
  const total = 1 + cnt;
  if (total >= car.capacity) return res.status(400).json({ error: "no seats left" });

  db.prepare(`INSERT INTO car_passengers (car_id, user_id) VALUES (?, ?)`).run(carId, user_id);
  res.json(carState(carId));
});

app.post("/api/cars/:id/leave", (req, res) => {
  const carId = Number(req.params.id);
  const { user_id } = req.body;
  if (!Number.isInteger(user_id)) return res.status(400).json({ error: "user_id required" });
  db.prepare(`DELETE FROM car_passengers WHERE car_id = ? AND user_id = ?`).run(carId, user_id);
  res.json(carState(carId));
});

// Auto-assign (可选简单策略：就近填满)
app.post("/api/auto-assign", (_req, res) => {
  const carIds = db.prepare(`SELECT id, capacity FROM cars ORDER BY id`).all();
  const unassigned = db.prepare(`
    SELECT u.id FROM users u
    WHERE u.is_driver = 0
      AND u.id NOT IN (SELECT user_id FROM car_passengers)
  `).all().map(r => r.id);

  for (const uid of unassigned) {
    for (const car of carIds) {
      const occ = db.prepare(`SELECT COUNT(*) as c FROM car_passengers WHERE car_id = ?`).get(car.id).c + 1;
      if (occ < car.capacity) {
        try { db.prepare(`INSERT OR IGNORE INTO car_passengers (car_id, user_id) VALUES (?, ?)`).run(car.id, uid); }
        catch {}
        break;
      }
    }
  }
  res.json(fullState());
});

// Full state + fees
app.get("/api/state", (_req, res) => {
  res.json(fullState());
});

// Purge (for testing)
app.post("/api/purge", (_req, res) => {
  db.exec(`
    DELETE FROM car_passengers;
    DELETE FROM cars;
    DELETE FROM users;
  `);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`🚗 Server listening on http://localhost:${PORT}`);
  console.log(`Endpoints: /api/users /api/cars /api/state ...`);
});