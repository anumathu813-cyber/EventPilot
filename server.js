const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const { promisify } = require("util");
const path = require("path");

const { pool, initializeDatabase } = require("./database");

const scrypt = promisify(crypto.scrypt);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const sessions = new Map();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Authentication middleware
async function authenticate(req, res, next) {
    try {
        const token = req.headers.authorization?.replace("Bearer ", "");
        const userId = sessions.get(token);

        if (!userId) {
            return res.status(401).json({
                error: "Please login first."
            });
        }

        const result = await pool.query(
            "SELECT id, name, email, role FROM users WHERE id = $1",
            [userId]
        );

        if (!result.rows.length) {
            return res.status(401).json({
                error: "User not found."
            });
        }

        req.user = result.rows[0];
        next();

    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Authentication failed."
        });
    }
}

// Password hashing
async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");

    const key = await scrypt(password, salt, 64);

    return `${salt}:${key.toString("hex")}`;
}

// Password verification
async function verifyPassword(password, stored) {
    const [salt, key] = stored.split(":");

    const newKey = await scrypt(password, salt, 64);

    return crypto.timingSafeEqual(
        Buffer.from(key, "hex"),
        newKey
    );
}

// HEALTH CHECK
app.get("/api/health", (req, res) => {
    res.json({
        status: "EventPilot is running"
    });
});

// REGISTER
app.post("/api/register", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        const cleanName = (name || "").trim();
        const cleanEmail = (email || "").trim().toLowerCase();

        if (!cleanName || !cleanEmail || !password || password.length < 8) {
            return res.status(400).json({
                error: "Enter all details. Password must have at least 8 characters."
            });
        }

        const existing = await pool.query(
            "SELECT id FROM users WHERE email = $1",
            [cleanEmail]
        );

        if (existing.rows.length) {
            return res.status(409).json({
                error: "Email already registered."
            });
        }

        const count = await pool.query(
            "SELECT COUNT(*) AS count FROM users"
        );

        const role = Number(count.rows[0].count) === 0
            ? "admin"
            : "member";

        const hashedPassword = await hashPassword(password);

        const result = await pool.query(
            `INSERT INTO users (name, email, password, role)
             VALUES ($1, $2, $3, $4)
             RETURNING id, name, email, role`,
            [cleanName, cleanEmail, hashedPassword, role]
        );

        res.status(201).json({
            message: "Registration successful.",
            user: result.rows[0]
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Registration failed."
        });
    }
});

// LOGIN
app.post("/api/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        const cleanEmail = (email || "").trim().toLowerCase();

        const result = await pool.query(
            "SELECT * FROM users WHERE email = $1",
            [cleanEmail]
        );

        if (!result.rows.length) {
            return res.status(401).json({
                error: "Invalid email or password."
            });
        }

        const user = result.rows[0];

        const valid = await verifyPassword(
            password || "",
            user.password
        );

        if (!valid) {
            return res.status(401).json({
                error: "Invalid email or password."
            });
        }

        const token = crypto.randomBytes(32).toString("hex");

        sessions.set(token, user.id);

        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Login failed."
        });
    }
});

// CURRENT USER
app.get("/api/me", authenticate, (req, res) => {
    res.json({
        user: req.user
    });
});

// LOGOUT
app.post("/api/logout", authenticate, (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");

    sessions.delete(token);

    res.json({
        message: "Logged out successfully."
    });
});

// GET TEAM MEMBERS
app.get("/api/users", authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, name, email, role FROM users ORDER BY id"
        );

        res.json(result.rows);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Could not load users."
        });
    }
});

// CREATE EVENT
app.post("/api/events", authenticate, async (req, res) => {
    try {
        if (req.user.role !== "admin") {
            return res.status(403).json({
                error: "Only admins can create events."
            });
        }

        const {
            title,
            description,
            event_date,
            location
        } = req.body;

        if (!title || !event_date) {
            return res.status(400).json({
                error: "Title and date are required."
            });
        }

        const result = await pool.query(
            `INSERT INTO events
             (title, description, event_date, location, created_by)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [
                title.trim(),
                description || "",
                event_date,
                location || "",
                req.user.id
            ]
        );

        const event = {
            ...result.rows[0],
            organizer: req.user.name
        };

        // Real-time event notification
        io.emit("event-created", event);

        res.status(201).json(event);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Could not create event."
        });
    }
});

// GET EVENTS
app.get("/api/events", authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                e.*,
                u.name AS organizer
            FROM events e
            LEFT JOIN users u ON e.created_by = u.id
            ORDER BY e.event_date ASC
        `);

        res.json(result.rows);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Could not load events."
        });
    }
});

// CREATE TASK
app.post("/api/tasks", authenticate, async (req, res) => {
    try {
        if (req.user.role !== "admin") {
            return res.status(403).json({
                error: "Only admins can create tasks."
            });
        }

        const {
            title,
            description,
            deadline,
            assigned_to,
            event_id
        } = req.body;

        if (!title || !assigned_to || !event_id) {
            return res.status(400).json({
                error: "Task title, assigned member and event are required."
            });
        }

        const member = await pool.query(
            "SELECT id FROM users WHERE id = $1",
            [assigned_to]
        );

        const event = await pool.query(
            "SELECT id FROM events WHERE id = $1",
            [event_id]
        );

        if (!member.rows.length || !event.rows.length) {
            return res.status(400).json({
                error: "Invalid member or event."
            });
        }

        const result = await pool.query(
            `INSERT INTO tasks
             (title, description, deadline, assigned_to, event_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [
                title.trim(),
                description || "",
                deadline || null,
                assigned_to,
                event_id
            ]
        );

        const taskResult = await pool.query(`
            SELECT
                t.*,
                u.name AS assigned_name,
                e.title AS event_title
            FROM tasks t
            LEFT JOIN users u ON t.assigned_to = u.id
            LEFT JOIN events e ON t.event_id = e.id
            WHERE t.id = $1
        `, [result.rows[0].id]);

        const task = taskResult.rows[0];

        // Real-time task notification
        io.emit("task-created", task);

        res.status(201).json(task);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Could not create task."
        });
    }
});

// GET TASKS
app.get("/api/tasks", authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                t.*,
                u.name AS assigned_name,
                e.title AS event_title
            FROM tasks t
            LEFT JOIN users u ON t.assigned_to = u.id
            LEFT JOIN events e ON t.event_id = e.id
            ORDER BY t.deadline ASC
        `);

        res.json(result.rows);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Could not load tasks."
        });
    }
});

// UPDATE TASK STATUS
app.patch("/api/tasks/:id/status", authenticate, async (req, res) => {
    try {
        const { status } = req.body;

        const allowed = [
            "Pending",
            "In Progress",
            "Completed"
        ];

        if (!allowed.includes(status)) {
            return res.status(400).json({
                error: "Invalid task status."
            });
        }

        const existing = await pool.query(
            "SELECT * FROM tasks WHERE id = $1",
            [req.params.id]
        );

        if (!existing.rows.length) {
            return res.status(404).json({
                error: "Task not found."
            });
        }

        const task = existing.rows[0];

        if (
            req.user.role !== "admin" &&
            Number(task.assigned_to) !== Number(req.user.id)
        ) {
            return res.status(403).json({
                error: "You cannot update this task."
            });
        }

        const result = await pool.query(
            `UPDATE tasks
             SET status = $1
             WHERE id = $2
             RETURNING *`,
            [status, req.params.id]
        );

        // Real-time status update
        io.emit("task-updated", result.rows[0]);

        res.json(result.rows[0]);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Could not update task."
        });
    }
});

// SOCKET.IO CONNECTION
io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("disconnect", () => {
        console.log("A user disconnected:", socket.id);
    });
});

// START SERVER AFTER DATABASE INITIALIZATION
initializeDatabase()
    .then(() => {
        server.listen(PORT, "0.0.0.0", () => {
            console.log("--------------------------------");
            console.log("EventPilot is running!");
            console.log(`Local: http://localhost:${PORT}`);
            console.log("--------------------------------");
        });
    })
    .catch((error) => {
        console.error("Database initialization failed:", error);
        process.exit(1);
    });